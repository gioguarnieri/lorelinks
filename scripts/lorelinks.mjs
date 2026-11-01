import { MODULE_ID } from "./constants.mjs";
import { activateUnresolvedListener, registerEnricher, resolveWikilink } from "./wikilinks.mjs";
import { createAutocompletePlugin } from "./autocomplete.mjs";

Hooks.once("init", () => {
  registerEnricher();
});

Hooks.once("ready", () => {
  activateUnresolvedListener();
  game.modules.get(MODULE_ID).api = { resolve: target => resolveWikilink({ target }) };
});

Hooks.on("createProseMirrorEditor", (uuid, plugins) => {
  plugins.lorelinksAutocomplete = createAutocompletePlugin();
});
