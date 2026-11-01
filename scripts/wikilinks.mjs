import { MODULE_ID, WIKILINK_PATTERN } from "./constants.mjs";

/**
 * @typedef Wikilink
 * @property {string} target          The note being linked to, without any type prefix.
 * @property {string} [section]       An optional page within the note (the part after #).
 * @property {string} [alias]         Optional text to display instead of the target (the part after |).
 * @property {string} [type]          "JournalEntry", "Actor" or "Item" when the link was written as [[Actor:Name]].
 */

/** Type prefixes that restrict a link to one kind of document, e.g. [[Actor:Rodolfo]]. */
const TYPE_PREFIXES = { actor: "Actor", item: "Item", journal: "JournalEntry" };
export const PREFIX_PATTERN = new RegExp(`^(${Object.keys(TYPE_PREFIXES).join("|")}):(.+)$`, "i");

/**
 * Normalize a name for case- and accent-insensitive comparison.
 * @param {string} name
 * @returns {string}
 */
export function normalizeName(name) {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase();
}

/**
 * Parse a regular expression match of WIKILINK_PATTERN.
 * @param {RegExpMatchArray} match
 * @returns {Wikilink}
 */
export function parseWikilink(match) {
  const [, rawTarget, section, alias] = match;
  let target = rawTarget.trim();
  let type;
  const prefixed = target.match(PREFIX_PATTERN);
  if ( prefixed ) {
    type = TYPE_PREFIXES[prefixed[1].toLowerCase()];
    target = prefixed[2].trim();
  }
  return { target, section: section?.trim(), alias: alias?.trim(), type };
}

/**
 * Whether the bracketed text belongs to another feature rather than LoreLinks.
 * Inline rolls ([[2d6]]) and chat or system commands ([[/r 1d20]], [[/check dex]]) share the double-bracket syntax.
 * @param {string} target
 * @returns {boolean}
 */
export function isForeignSyntax(target) {
  if ( target.startsWith("/") ) return true;
  try {
    return Roll.defaultImplementation.validate(target);
  } catch {
    return false;
  }
}

/**
 * Find every wikilink in a piece of plain text.
 * @param {string} text
 * @returns {Wikilink[]}
 */
export function extractWikilinks(text) {
  const links = [];
  for ( const match of text.matchAll(WIKILINK_PATTERN) ) {
    const link = parseWikilink(match);
    if ( !isForeignSyntax(link.target) ) links.push(link);
  }
  return links;
}

/**
 * Find the document a wikilink points to.
 * Journal entries are matched first, then pages of any entry, then actors, then world items. A type prefix limits the
 * search to one kind of document. With a section, the page inside the matched entry is returned, falling back to the
 * entry itself.
 * @param {Wikilink} link
 * @returns {JournalEntry|JournalEntryPage|Actor|Item|null}
 */
export function resolveWikilink({ target, section, type }) {
  const name = normalizeName(target);
  const findPage = (entry, pageName) => entry.pages.find(p => normalizeName(p.name) === pageName);
  const allows = documentName => !type || (type === documentName);

  if ( allows("JournalEntry") ) {
    const entry = game.journal.find(j => normalizeName(j.name) === name);
    if ( entry ) return (section && findPage(entry, normalizeName(section))) || entry;

    for ( const journal of game.journal ) {
      const page = findPage(journal, name);
      if ( page ) return page;
    }
  }
  if ( allows("Actor") ) {
    const actor = game.actors.find(a => normalizeName(a.name) === name);
    if ( actor ) return actor;
  }
  if ( allows("Item") ) return game.items.find(i => normalizeName(i.name) === name) ?? null;
  return null;
}

/**
 * The text shown for a wikilink.
 * @param {Wikilink} link
 * @returns {string}
 */
function displayText({ target, section, alias }) {
  if ( alias ) return alias;
  return section ? `${target} › ${section}` : target;
}

/**
 * Replace a matched wikilink with a content link, or with an "unresolved" link when no note exists yet.
 * @param {RegExpMatchArray} match
 * @returns {Promise<HTMLElement|null>}
 */
async function enrichWikilink(match) {
  const link = parseWikilink(match);
  if ( isForeignSyntax(link.target) ) return null;
  const text = displayText(link);
  const doc = resolveWikilink(link);

  // Users who cannot see the note get plain text, so links never reveal hidden notes.
  if ( doc && !doc.testUserPermission(game.user, "LIMITED") ) {
    const span = document.createElement("span");
    span.classList.add("lorelinks-hidden");
    span.textContent = text;
    return span;
  }
  if ( doc ) return doc.toAnchor({ name: text, classes: ["lorelinks-link"] });

  const a = document.createElement("a");
  a.classList.add("lorelinks-unresolved");
  a.dataset.lorelinksTarget = link.target;
  a.dataset.tooltipText = game.i18n.format("LORELINKS.Unresolved", { name: link.target });
  a.textContent = text;
  return a;
}

/**
 * Register the wikilink enricher. Must run during the init hook.
 */
export function registerEnricher() {
  CONFIG.TextEditor.enrichers.push({ id: MODULE_ID, pattern: WIKILINK_PATTERN, enricher: enrichWikilink });
}

/**
 * Create the journal entry for a missing note and open it, if the user is allowed to create journal entries.
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function createMissingNote(name) {
  const existing = resolveWikilink({ target: name });
  if ( existing ) return void existing.sheet.render({ force: true });

  if ( !JournalEntry.canUserCreate(game.user) ) {
    return void ui.notifications.warn("LORELINKS.CannotCreate", { format: { name } });
  }
  const entry = await JournalEntry.implementation.create({
    name,
    pages: [{ name, type: "text", text: { content: "" } }]
  });
  entry?.sheet.render({ force: true });
}

/**
 * Clicking an unresolved link creates the missing note, like in Obsidian.
 * @param {PointerEvent} event
 */
function onClickUnresolved(event) {
  const anchor = event.target.closest("a.lorelinks-unresolved");
  if ( !anchor ) return;
  event.preventDefault();
  event.stopPropagation();
  createMissingNote(anchor.dataset.lorelinksTarget);
}

/**
 * Listen for clicks on unresolved links anywhere in the given document.
 * @param {Document} [doc]
 */
export function activateUnresolvedListener(doc = document) {
  doc.addEventListener("click", onClickUnresolved, { capture: true });
}
