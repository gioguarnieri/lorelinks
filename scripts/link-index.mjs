import { extractWikilinks, normalizeName, resolveWikilink } from "./wikilinks.mjs";

/**
 * @typedef GraphNode
 * @property {string} id            The document UUID, or "unresolved:<name>" for notes that do not exist yet.
 * @property {string} label         The displayed name.
 * @property {"journal"|"actor"|"item"|"unresolved"} kind
 * @property {foundry.abstract.Document} [doc]  The journal entry, actor or item this node stands for.
 */

/**
 * @typedef GraphData
 * @property {GraphNode[]} nodes
 * @property {{source: string, target: string}[]} edges
 */

/**
 * @typedef TextField
 * @property {JournalEntryPage|Actor|Item} doc   The document that stores the text.
 * @property {string} path                       The field's path for Document#update, e.g. "text.content".
 * @property {string} value                      The stored text.
 * @property {boolean} html                      Whether the text is HTML (otherwise Markdown or plain text).
 */

/** Graph node kind for each top-level document type. */
const KINDS = { JournalEntry: "journal", Actor: "actor", Item: "item" };

/**
 * Paths of the HTML fields in a document type's system data, e.g. "system.details.biography.value" for dnd5e
 * characters. Read from the system's data model so any game system works; cached per document and sub-type.
 * @type {Map<string, string[]>}
 */
const htmlPathsByType = new Map();

/**
 * @param {Actor|Item} doc
 * @returns {string[]}
 */
function htmlFieldPaths(doc) {
  const key = `${doc.documentName}.${doc.type}`;
  if ( htmlPathsByType.has(key) ) return htmlPathsByType.get(key);
  const { HTMLField, SchemaField } = foundry.data.fields;
  const paths = [];
  const walk = (field, prefix) => {
    if ( field instanceof HTMLField ) paths.push(prefix);
    else if ( field instanceof SchemaField ) {
      for ( const [name, child] of Object.entries(field.fields) ) walk(child, `${prefix}.${name}`);
    }
  };
  const schema = doc.system?.schema;
  if ( schema ) walk(schema, "system");
  htmlPathsByType.set(key, paths);
  return paths;
}

/**
 * Every text field of a journal entry, actor or world item in which wikilinks can be written.
 * @param {JournalEntry|Actor|Item} doc
 * @returns {TextField[]}
 */
export function textFields(doc) {
  const fields = [];
  const add = (owner, path, html) => {
    const value = foundry.utils.getProperty(owner, path);
    if ( value ) fields.push({ doc: owner, path, value, html });
  };
  if ( doc instanceof JournalEntry ) {
    for ( const page of doc.pages ) {
      add(page, "text.content", true);
      add(page, "text.markdown", false);
    }
  }
  else for ( const path of htmlFieldPaths(doc) ) add(doc, path, true);
  return fields;
}

/**
 * Plain text of an HTML string, so links split by formatting tags are still found.
 * @param {string} html
 * @returns {string}
 */
export function toPlainText(html) {
  if ( !html ) return "";
  return foundry.applications.ux.TextEditor.implementation.decodeHTML(html.replace(/<[^>]*>/g, ""));
}

/**
 * The documents whose text the index reads: all journal entries, actors and world items.
 * @returns {(JournalEntry|Actor|Item)[]}
 */
export function linkableDocuments() {
  return [...game.journal, ...game.actors, ...game.items];
}

/**
 * The graph node a resolved link points to. Links to a page count as links to its journal entry.
 * @param {foundry.abstract.Document} doc
 * @returns {JournalEntry|Actor|Item}
 */
function nodeDocument(doc) {
  return doc instanceof JournalEntryPage ? doc.parent : doc;
}

/**
 * Which documents link to which. Rebuilt lazily after any journal, actor or item changes.
 */
class LinkIndex {
  /** @type {Map<string, Set<string>>} Outgoing links: source UUID → target node ids. */
  #outgoing = new Map();

  /** @type {Map<string, string>} Display names of unresolved targets, keyed by node id. */
  #unresolved = new Map();

  #dirty = true;

  /** Mark the index stale; it is rebuilt the next time it is read. */
  invalidate() {
    this.#dirty = true;
  }

  #rebuild() {
    this.#outgoing.clear();
    this.#unresolved.clear();
    for ( const doc of linkableDocuments() ) {
      const text = textFields(doc).map(f => (f.html ? toPlainText(f.value) : f.value)).join("\n");
      const targets = new Set();
      for ( const link of extractWikilinks(text) ) {
        const resolved = resolveWikilink(link);
        if ( resolved ) targets.add(nodeDocument(resolved).uuid);
        else {
          const id = `unresolved:${normalizeName(link.target)}`;
          if ( !this.#unresolved.has(id) ) this.#unresolved.set(id, link.target);
          targets.add(id);
        }
      }
      targets.delete(doc.uuid);
      if ( targets.size ) this.#outgoing.set(doc.uuid, targets);
    }
    this.#dirty = false;
  }

  /**
   * The documents that link to a given document.
   * @param {JournalEntry|Actor|Item} doc
   * @returns {(JournalEntry|Actor|Item)[]}
   */
  backlinks(doc) {
    if ( this.#dirty ) this.#rebuild();
    const sources = [];
    for ( const [source, targets] of this.#outgoing ) {
      if ( targets.has(doc.uuid) ) sources.push(fromUuidSync(source));
    }
    return sources.filter(Boolean);
  }

  /**
   * Nodes and edges visible to the current user. Documents the user cannot see are left out entirely.
   * @param {object} [options]
   * @param {boolean} [options.actors=true]       Include actors.
   * @param {boolean} [options.items=true]        Include world items.
   * @param {boolean} [options.unresolved=true]   Include links to notes that do not exist yet.
   * @param {boolean} [options.orphans=true]      Include documents without any links.
   * @returns {GraphData}
   */
  graph({ actors = true, items = true, unresolved = true, orphans = true } = {}) {
    if ( this.#dirty ) this.#rebuild();
    const include = { JournalEntry: true, Actor: actors, Item: items };
    const nodes = new Map();
    for ( const doc of linkableDocuments() ) {
      if ( !include[doc.documentName] || !doc.testUserPermission(game.user, "LIMITED") ) continue;
      nodes.set(doc.uuid, { id: doc.uuid, label: doc.name, kind: KINDS[doc.documentName], doc });
    }

    // Missing notes only appear when a visible document links to them, so hidden notes never leak names.
    const edges = [];
    for ( const [source, targets] of this.#outgoing ) {
      if ( !nodes.has(source) ) continue;
      for ( const target of targets ) {
        if ( unresolved && this.#unresolved.has(target) && !nodes.has(target) ) {
          nodes.set(target, { id: target, label: this.#unresolved.get(target), kind: "unresolved" });
        }
        if ( nodes.has(target) ) edges.push({ source, target });
      }
    }
    if ( !orphans ) {
      const linked = new Set(edges.flatMap(e => [e.source, e.target]));
      for ( const id of nodes.keys() ) if ( !linked.has(id) ) nodes.delete(id);
    }
    return { nodes: [...nodes.values()], edges };
  }
}

export const linkIndex = new LinkIndex();

/**
 * Keep the index fresh: any change to journals, actors or items may add, remove or rename link targets.
 * @param {function(): void} onChange  Called after the index was invalidated.
 */
export function watchDocuments(onChange) {
  const invalidate = () => {
    linkIndex.invalidate();
    onChange();
  };
  for ( const type of ["JournalEntry", "JournalEntryPage", "Actor", "Item"] ) {
    for ( const action of ["create", "update", "delete"] ) Hooks.on(`${action}${type}`, invalidate);
  }
}
