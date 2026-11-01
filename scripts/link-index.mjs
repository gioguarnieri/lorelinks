import { extractWikilinks, normalizeName, resolveWikilink } from "./wikilinks.mjs";

/**
 * @typedef GraphNode
 * @property {string} id            The document UUID, or "unresolved:<name>" for notes that do not exist yet.
 * @property {string} label         The displayed name.
 * @property {"journal"|"actor"|"unresolved"} kind
 * @property {foundry.abstract.Document} [doc]  The journal entry or actor this node stands for.
 */

/**
 * @typedef GraphData
 * @property {GraphNode[]} nodes
 * @property {{source: string, target: string}[]} edges
 */

/**
 * Paths of the HTML fields in an actor type's system data, e.g. "details.biography.value" for dnd5e characters.
 * Read from the system's data model so any game system works; cached per actor type.
 * @type {Map<string, string[]>}
 */
const htmlPathsByType = new Map();

/**
 * @param {Actor} actor
 * @returns {string[]}
 */
function htmlFieldPaths(actor) {
  if ( htmlPathsByType.has(actor.type) ) return htmlPathsByType.get(actor.type);
  const { HTMLField, SchemaField } = foundry.data.fields;
  const paths = [];
  const walk = (field, prefix) => {
    if ( field instanceof HTMLField ) paths.push(prefix);
    else if ( field instanceof SchemaField ) {
      for ( const [key, child] of Object.entries(field.fields) ) walk(child, prefix ? `${prefix}.${key}` : key);
    }
  };
  const schema = actor.system?.schema;
  if ( schema ) walk(schema, "");
  htmlPathsByType.set(actor.type, paths);
  return paths;
}

/**
 * Plain text of an HTML string, so links split by formatting tags are still found.
 * @param {string} html
 * @returns {string}
 */
function toPlainText(html) {
  if ( !html ) return "";
  return foundry.applications.ux.TextEditor.implementation.decodeHTML(html.replace(/<[^>]*>/g, ""));
}

/**
 * All the text in which a document can contain wikilinks.
 * @param {JournalEntry|Actor} doc
 * @returns {string}
 */
function linkableText(doc) {
  if ( doc instanceof JournalEntry ) {
    return doc.pages.map(p => `${toPlainText(p.text?.content)}\n${p.text?.markdown ?? ""}`).join("\n");
  }
  return htmlFieldPaths(doc).map(path => toPlainText(foundry.utils.getProperty(doc.system, path))).join("\n");
}

/**
 * The graph node a resolved link points to. Links to a page count as links to its journal entry.
 * @param {foundry.abstract.Document} doc
 * @returns {JournalEntry|Actor}
 */
function nodeDocument(doc) {
  return doc instanceof JournalEntryPage ? doc.parent : doc;
}

/**
 * Which documents link to which. Rebuilt lazily after any journal or actor changes.
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
    for ( const doc of [...game.journal, ...game.actors] ) {
      const targets = new Set();
      for ( const link of extractWikilinks(linkableText(doc)) ) {
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
   * @param {JournalEntry|Actor} doc
   * @returns {(JournalEntry|Actor)[]}
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
   * @param {boolean} [options.unresolved=true]   Include links to notes that do not exist yet.
   * @param {boolean} [options.orphans=true]      Include documents without any links.
   * @returns {GraphData}
   */
  graph({ actors = true, unresolved = true, orphans = true } = {}) {
    if ( this.#dirty ) this.#rebuild();
    const nodes = new Map();
    const visible = doc => doc.testUserPermission(game.user, "LIMITED");
    for ( const entry of game.journal ) {
      if ( visible(entry) ) nodes.set(entry.uuid, { id: entry.uuid, label: entry.name, kind: "journal", doc: entry });
    }
    if ( actors ) {
      for ( const actor of game.actors ) {
        if ( visible(actor) ) nodes.set(actor.uuid, { id: actor.uuid, label: actor.name, kind: "actor", doc: actor });
      }
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
 * Keep the index fresh: any change to journals or actors may add, remove or rename link targets.
 * @param {function(): void} onChange  Called after the index was invalidated.
 */
export function watchDocuments(onChange) {
  const invalidate = () => {
    linkIndex.invalidate();
    onChange();
  };
  for ( const type of ["JournalEntry", "JournalEntryPage", "Actor"] ) {
    for ( const action of ["create", "update", "delete"] ) Hooks.on(`${action}${type}`, invalidate);
  }
}
