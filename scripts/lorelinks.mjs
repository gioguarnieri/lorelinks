import { MODULE_ID } from "./constants.mjs";
import { activateUnresolvedListener, registerEnricher, resolveWikilink } from "./wikilinks.mjs";
import { createAutocompletePlugin } from "./autocomplete.mjs";
import { linkIndex, watchDocuments } from "./link-index.mjs";
import { GraphView } from "./graph.mjs";
import { registerRenameHandling } from "./rename.mjs";
import { exportVault } from "./obsidian/export.mjs";
import { importVault } from "./obsidian/import.mjs";
import { openExportDialog, openImportDialog } from "./obsidian/dialogs.mjs";

Hooks.once("init", () => {
  registerEnricher();
  registerRenameHandling();
  game.keybindings.register(MODULE_ID, "openGraph", {
    name: "LORELINKS.Graph.Open",
    editable: [{ key: "KeyG", modifiers: ["Control", "Shift"] }],
    onDown: () => {
      GraphView.open();
      return true;
    }
  });
});

Hooks.once("ready", () => {
  activateUnresolvedListener();
  watchDocuments(GraphView.refresh);
  game.modules.get(MODULE_ID).api = {
    resolve: target => resolveWikilink({ target }),
    backlinks: doc => linkIndex.backlinks(doc),
    openGraph: () => GraphView.open(),
    exportVault,
    importVault
  };
});

Hooks.on("createProseMirrorEditor", (uuid, plugins) => {
  plugins.lorelinksAutocomplete = createAutocompletePlugin();
});

/**
 * A sidebar header button.
 * @param {string} cls       CSS class, also used to avoid adding the button twice.
 * @param {string} icon      Font Awesome icon class.
 * @param {string} labelKey  Translation key for the label.
 * @param {function(): void} onClick
 * @param {boolean} [iconOnly=false]  Show only the icon, with the label as a tooltip.
 * @returns {HTMLButtonElement}
 */
function headerButton(cls, icon, labelKey, onClick, iconOnly = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add(cls);
  const label = game.i18n.localize(labelKey);
  button.innerHTML = `<i class="${icon}" inert></i>${iconOnly ? "" : ` ${label}`}`;
  if ( iconOnly ) Object.assign(button.dataset, { tooltipText: label });
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Add LoreLinks buttons to a sidebar tab header: the graph everywhere, Obsidian export and import for GMs in the
 * Journal tab.
 * @param {foundry.applications.sidebar.DocumentDirectory} app
 * @param {HTMLElement} html
 */
function addHeaderButtons(app, html) {
  const actions = html.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".lorelinks-open-graph") ) return;
  actions.append(headerButton("lorelinks-open-graph", "fa-solid fa-diagram-project", "LORELINKS.Graph.Open",
    () => GraphView.open()));
  if ( (app.documentName === "JournalEntry") && game.user.isGM ) {
    actions.append(
      headerButton("lorelinks-obsidian-export", "fa-solid fa-file-export", "LORELINKS.Obsidian.Export.Title",
        openExportDialog, true),
      headerButton("lorelinks-obsidian-import", "fa-solid fa-file-import", "LORELINKS.Obsidian.Import.Title",
        openImportDialog, true)
    );
  }
}

Hooks.on("renderJournalDirectory", addHeaderButtons);
Hooks.on("renderActorDirectory", addHeaderButtons);
Hooks.on("renderItemDirectory", addHeaderButtons);
