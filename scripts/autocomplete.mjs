import { MAX_SUGGESTIONS } from "./constants.mjs";
import { normalizeName } from "./wikilinks.mjs";

/** Text before the cursor that opens the menu: "[[" followed by a partial name without brackets, | or #. */
const TRIGGER = /\[\[([^\[\]|#]*)$/;

/**
 * @typedef Suggestion
 * @property {string} insert   The text inserted between the brackets.
 * @property {string} label    The text shown in the menu.
 * @property {number} rank     Lower ranks are shown first.
 */

/**
 * Collect journal entries and pages matching the typed query, visible to the current user.
 * @param {string} query
 * @returns {Suggestion[]}
 */
function getSuggestions(query) {
  const q = normalizeName(query);
  const rankOf = name => {
    const n = normalizeName(name);
    if ( !q || n.startsWith(q) ) return 0;
    return n.includes(q) ? 1 : -1;
  };

  const results = [];
  for ( const entry of game.journal ) {
    if ( !entry.testUserPermission(game.user, "LIMITED") ) continue;
    const entryRank = rankOf(entry.name);
    if ( entryRank >= 0 ) results.push({ insert: entry.name, label: entry.name, rank: entryRank });

    // Pages are offered as [[Entry#Page]]; single-page entries named like their page would only duplicate the entry.
    if ( entry.pages.size < 2 ) continue;
    for ( const page of entry.pages ) {
      if ( normalizeName(page.name) === normalizeName(entry.name) ) continue;
      if ( !page.testUserPermission(game.user, "LIMITED") ) continue;
      const pageRank = rankOf(page.name);
      if ( pageRank >= 0 ) {
        results.push({ insert: `${entry.name}#${page.name}`, label: `${entry.name} › ${page.name}`, rank: pageRank + 0.5 });
      }
    }
  }
  results.sort((a, b) => (a.rank - b.rank) || a.label.localeCompare(b.label, game.i18n.lang));
  return results.slice(0, MAX_SUGGESTIONS);
}

/**
 * Build the menu entries for a query, ending with an option to link a note that does not exist yet.
 * @param {string} query
 * @returns {{identifier: string, label: string}[]}  Entries for foundry.applications.ux.Autocomplete.
 */
function buildEntries(query) {
  const suggestions = getSuggestions(query);
  const entries = suggestions.map(s => ({ identifier: s.insert, label: s.label }));
  const trimmed = query.trim();
  const exists = suggestions.some(s => normalizeName(s.insert) === normalizeName(trimmed));
  if ( trimmed && !exists ) {
    entries.push({ identifier: trimmed, label: game.i18n.format("LORELINKS.NewNote", { name: trimmed }) });
  }
  return entries;
}

/**
 * A ProseMirror plugin that shows note suggestions while typing [[ in a journal editor.
 * @returns {Plugin}
 */
export function createAutocompletePlugin() {
  const { Plugin, TextSelection } = foundry.prosemirror.state;

  return new Plugin({
    view(editorView) {
      /** The partial name typed after [[, or null when the menu is closed. */
      let query = null;

      const onSelect = insert => {
        const { state } = editorView;
        const { $cursor } = state.selection;
        if ( !$cursor || (query === null) ) return;
        const from = $cursor.pos - query.length - 2;
        const text = `[[${insert}]]`;
        let tr = state.tr.insertText(text, from, $cursor.pos);
        tr = tr.setSelection(TextSelection.create(tr.doc, from + text.length));
        query = null;
        editorView.dispatch(tr);
        editorView.focus();
      };
      const menu = new foundry.applications.ux.Autocomplete.implementation({ onSelect });

      const close = () => {
        if ( (query !== null) && (ui.autocomplete === menu) ) menu.dismiss();
        query = null;
      };

      return {
        update(view) {
          const { $cursor } = view.state.selection;
          const before = $cursor?.parent.textBetween(0, $cursor.parentOffset, null, "￼") ?? "";
          const match = view.hasFocus() ? before.match(TRIGGER) : null;
          if ( !match ) return close();
          if ( match[1] === query ) return;

          query = match[1];
          const entries = buildEntries(query);
          if ( !entries.length ) return menu.dismiss();
          const coords = view.coordsAtPos($cursor.pos);
          menu.activate(view.dom, entries, { position: { top: coords.bottom, left: coords.left } });
          menu.select(); // Highlight the first entry so Enter accepts it right away.
        },
        destroy: close
      };
    }
  });
}
