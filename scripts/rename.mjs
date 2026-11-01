import { MODULE_ID, WIKILINK_PATTERN } from "./constants.mjs";
import { isForeignSyntax, normalizeName, parseWikilink, PREFIX_PATTERN, resolveWikilink } from "./wikilinks.mjs";
import { linkableDocuments, textFields } from "./link-index.mjs";

/** Setting values for what happens to links when a document is renamed. */
export const RENAME_MODES = { ask: "ask", always: "always", never: "never" };

/**
 * @typedef PendingRename
 * @property {string} oldName
 * @property {Map<string, {doc: foundry.abstract.Document, path: string, html: boolean, raws: Set<string>}>} fields
 *   The text fields holding links to the renamed document, keyed by "<uuid>|<path>", with the exact link texts
 *   ("[[Old Name|alias]]") that pointed to it before the rename.
 * @property {number} count  The number of link occurrences found.
 */

/** Links found just before a rename, keyed by the renamed document's UUID. */
const pending = new Map();

/**
 * The document types whose names can be link targets.
 * @param {foundry.abstract.Document} doc
 * @returns {boolean}
 */
function isLinkTarget(doc) {
  if ( doc instanceof JournalEntryPage ) return true;
  return ((doc instanceof JournalEntry) || (doc instanceof Actor) || (doc instanceof Item)) && !doc.parent;
}

/**
 * Whether a link points to the document being renamed, and which part of the link names it.
 * Links to a page inside a renamed journal entry ([[Entry#Page]]) name the entry in their target.
 * @param {import("./wikilinks.mjs").Wikilink} link
 * @param {foundry.abstract.Document} doc
 * @returns {"target"|"section"|null}
 */
function linkRole(link, doc) {
  const resolved = resolveWikilink(link);
  if ( !resolved ) return null;
  if ( doc instanceof JournalEntryPage ) {
    if ( resolved !== doc ) return null;
    return (link.section && (normalizeName(link.section) === normalizeName(doc.name))) ? "section" : "target";
  }
  if ( resolved === doc ) return "target";
  if ( (resolved instanceof JournalEntryPage) && (resolved.parent === doc) && link.section ) return "target";
  return null;
}

/**
 * Decode HTML entities in a link found in raw HTML, so "Fish &amp; Chips" compares as "Fish & Chips".
 * @param {string} text
 * @returns {string}
 */
function decode(text) {
  return foundry.applications.ux.TextEditor.implementation.decodeHTML(text);
}

/**
 * Before a rename is saved, record every link that points to the document under its current name.
 * @param {foundry.abstract.Document} doc
 * @param {object} changes
 * @param {object} options
 * @param {string} userId
 */
function onPreUpdate(doc, changes, options, userId) {
  if ( (userId !== game.user.id) || !isLinkTarget(doc) ) return;
  if ( !("name" in changes) || (changes.name === doc.name) || !changes.name?.trim() ) return;
  if ( game.settings.get(MODULE_ID, "renameLinks") === RENAME_MODES.never ) return;

  const fields = new Map();
  let count = 0;
  for ( const source of linkableDocuments() ) {
    for ( const field of textFields(source) ) {
      for ( const match of field.value.matchAll(WIKILINK_PATTERN) ) {
        const raw = match[0];
        const parsed = field.html ? decode(raw).match(new RegExp(WIKILINK_PATTERN.source)) : match;
        if ( !parsed ) continue;
        const link = parseWikilink(parsed);
        if ( isForeignSyntax(link.target) || !linkRole(link, doc) ) continue;
        const key = `${field.doc.uuid}|${field.path}`;
        if ( !fields.has(key) ) fields.set(key, { doc: field.doc, path: field.path, html: field.html, raws: new Set() });
        fields.get(key).raws.add(raw);
        count++;
      }
    }
  }
  if ( count ) pending.set(doc.uuid, { oldName: doc.name, fields, count });
}

/**
 * Rewrite one link so it names the renamed document, keeping its type prefix, section and alias.
 * @param {string} raw                     The link as stored, e.g. "[[Actor:Old Name|the bard]]".
 * @param {boolean} html                   Whether the link is stored inside HTML.
 * @param {foundry.abstract.Document} doc  The renamed document.
 * @param {string} oldName
 * @returns {string}
 */
function rewriteLink(raw, html, doc, oldName) {
  const text = html ? decode(raw) : raw;
  const [, rawTarget, section, alias] = text.match(new RegExp(WIKILINK_PATTERN.source));
  const prefixed = rawTarget.trim().match(PREFIX_PATTERN);
  const prefix = prefixed ? `${prefixed[1]}:` : "";
  let target = prefixed ? prefixed[2].trim() : rawTarget.trim();
  let newSection = section?.trim();

  const isOld = name => name && (normalizeName(name) === normalizeName(oldName));
  if ( (doc instanceof JournalEntryPage) && isOld(newSection) ) newSection = doc.name;
  else if ( isOld(target) ) target = doc.name;

  let rebuilt = `[[${prefix}${target}${newSection ? `#${newSection}` : ""}${alias ? `|${alias.trim()}` : ""}]]`;
  if ( html ) rebuilt = foundry.utils.escapeHTML(rebuilt);
  return rebuilt;
}

/**
 * After a rename is saved, offer to update the links recorded beforehand and apply the changes.
 * @param {foundry.abstract.Document} doc
 * @param {object} changes
 * @param {object} options
 * @param {string} userId
 */
async function onUpdate(doc, changes, options, userId) {
  const rename = pending.get(doc.uuid);
  if ( !rename || (userId !== game.user.id) ) return;
  pending.delete(doc.uuid);
  if ( !("name" in changes) ) return;

  const editable = [...rename.fields.values()].filter(f => f.doc.isOwner);
  const skipped = rename.fields.size - editable.length;
  if ( !editable.length ) {
    return void ui.notifications.warn("LORELINKS.Rename.NoPermission", { format: { name: rename.oldName } });
  }

  if ( game.settings.get(MODULE_ID, "renameLinks") === RENAME_MODES.ask ) {
    const sources = new Set(editable.map(f => f.doc.parent?.uuid ?? f.doc.uuid)).size;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "LORELINKS.Rename.Title", icon: "fa-solid fa-link" },
      content: `<p>${game.i18n.format("LORELINKS.Rename.Prompt", {
        old: foundry.utils.escapeHTML(rename.oldName), new: foundry.utils.escapeHTML(doc.name),
        count: rename.count, sources })}</p>`,
      yes: { label: "LORELINKS.Rename.Update" },
      no: { label: "LORELINKS.Rename.Keep" }
    });
    if ( !confirmed ) return;
  }

  // Group the changes into one update per document, and one embedded update per journal entry for its pages.
  const updates = new Map();
  for ( const field of editable ) {
    let value = foundry.utils.getProperty(field.doc, field.path) ?? "";
    for ( const raw of field.raws ) value = value.split(raw).join(rewriteLink(raw, field.html, doc, rename.oldName));
    const target = field.doc;
    if ( !updates.has(target) ) updates.set(target, { _id: target.id });
    updates.get(target)[field.path] = value;
  }

  const pagesByEntry = new Map();
  const byCollection = { Actor: [], Item: [] };
  for ( const [target, update] of updates ) {
    if ( target instanceof JournalEntryPage ) {
      if ( !pagesByEntry.has(target.parent) ) pagesByEntry.set(target.parent, []);
      pagesByEntry.get(target.parent).push(update);
    }
    else byCollection[target.documentName].push(update);
  }
  for ( const [entry, pageUpdates] of pagesByEntry ) {
    await entry.updateEmbeddedDocuments("JournalEntryPage", pageUpdates, { lorelinksRename: true });
  }
  if ( byCollection.Actor.length ) await Actor.implementation.updateDocuments(byCollection.Actor, { lorelinksRename: true });
  if ( byCollection.Item.length ) await Item.implementation.updateDocuments(byCollection.Item, { lorelinksRename: true });

  ui.notifications.info("LORELINKS.Rename.Done", { format: { count: rename.count, name: doc.name } });
  if ( skipped ) ui.notifications.warn("LORELINKS.Rename.Skipped", { format: { count: skipped } });
}

/**
 * Register the world setting and the hooks that keep links working when documents are renamed.
 * Must run during the init hook.
 */
export function registerRenameHandling() {
  game.settings.register(MODULE_ID, "renameLinks", {
    name: "LORELINKS.Settings.RenameLinks.Name",
    hint: "LORELINKS.Settings.RenameLinks.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [RENAME_MODES.ask]: "LORELINKS.Settings.RenameLinks.Ask",
      [RENAME_MODES.always]: "LORELINKS.Settings.RenameLinks.Always",
      [RENAME_MODES.never]: "LORELINKS.Settings.RenameLinks.Never"
    },
    default: RENAME_MODES.ask
  });
  for ( const type of ["JournalEntry", "JournalEntryPage", "Actor", "Item"] ) {
    Hooks.on(`preUpdate${type}`, onPreUpdate);
    Hooks.on(`update${type}`, onUpdate);
  }
}
