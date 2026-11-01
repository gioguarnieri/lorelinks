import { MODULE_ID } from "./constants.mjs";
import { activateUnresolvedListener, registerEnricher, resolveWikilink } from "./wikilinks.mjs";
import { createAutocompletePlugin } from "./autocomplete.mjs";
import { linkIndex, watchDocuments } from "./link-index.mjs";
import { GraphView } from "./graph.mjs";
import { registerRenameHandling } from "./rename.mjs";

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
    openGraph: () => GraphView.open()
  };
});

Hooks.on("createProseMirrorEditor", (uuid, plugins) => {
  plugins.lorelinksAutocomplete = createAutocompletePlugin();
});

/**
 * Add an "Open graph" button to the header of the Journal, Actors and Items sidebar tabs.
 * @param {foundry.applications.sidebar.DocumentDirectory} app
 * @param {HTMLElement} html
 */
function addGraphButton(app, html) {
  if ( html.querySelector(".lorelinks-open-graph") ) return;
  const actions = html.querySelector(".header-actions");
  if ( !actions ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("lorelinks-open-graph");
  button.innerHTML = `<i class="fa-solid fa-diagram-project" inert></i> ${game.i18n.localize("LORELINKS.Graph.Open")}`;
  button.addEventListener("click", () => GraphView.open());
  actions.append(button);
}

Hooks.on("renderJournalDirectory", addGraphButton);
Hooks.on("renderActorDirectory", addGraphButton);
Hooks.on("renderItemDirectory", addGraphButton);
