# LoreLinks

Obsidian-style `[[wikilinks]]` and a graph view for [Foundry Virtual Tabletop](https://foundryvtt.com) journals and
characters.

Write `[[Name of a note]]` in any journal page or character biography and it becomes a link. Type `[[` and LoreLinks
suggests the notes and characters you can link to. Open the graph to see how everything connects.

## Features

- **Wikilinks** – `[[Note]]` links to the journal entry, page or actor with that name. Matching ignores case and
  accents. Journal entries win when names clash; write `[[Actor:Name]]` to link the actor instead.
- **Characters as notes** – links work in actor biographies and other rich-text fields, in any game system, and
  `[[Character Name]]` opens the character sheet.
- **Sections and aliases** – `[[Note#Page]]` links to a page inside a note, `[[Note|shown text]]` changes the text.
- **Autocomplete** – type `[[` in any rich-text editor (journals, biographies) to pick a note or actor with the arrow
  keys and Enter.
- **Graph view** – notes and actors as dots, links as lines. Zoom with the mouse wheel, drag to pan or move dots,
  hover to highlight connections, search by name, and click a dot to open it. Open it from the **Graph** button in
  the Journal or Actors sidebar, or with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>.
- **Unresolved links** – links to notes that do not exist yet are shown dashed; clicking one creates the note.
- **Respects permissions** – players see plain text instead of a link when they cannot view the target, and the graph
  only shows what the viewing user is allowed to see.
- Works anywhere Foundry renders rich text: journals, actor biographies, item descriptions and chat.

Inline rolls such as `[[1d20]]` and commands such as `[[/r 2d6]]` or `[[/check dex]]` keep working as before.

## Installation

In Foundry's **Add-on Modules** tab, choose **Install Module** and paste this manifest URL:

```
https://github.com/gioguarnieri/lorelinks/releases/latest/download/module.json
```

Requires Foundry VTT version 14.

## Roadmap

- Backlinks panel listing the notes that link to the current one (the index already tracks backlinks)
- Local graph centered on the open note
- Updating links automatically when a note is renamed
- Autocomplete in Markdown pages

## Development

Clone the repository into your Foundry `Data/modules` folder (or symlink it there) as `lorelinks`, then enable the
module in a world. The code is plain ES modules with no build step.

Releases are built by GitHub Actions: publishing a GitHub release tagged `vX.Y.Z` produces `module.json` and
`lorelinks.zip` with matching version and download URLs.

## License

[MIT](LICENSE)
