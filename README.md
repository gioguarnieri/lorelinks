# LoreLinks

Obsidian-style `[[wikilinks]]` and a graph view for [Foundry Virtual Tabletop](https://foundryvtt.com) journals and
characters.

Write `[[Name of a note]]` in any journal page or character biography and it becomes a link. Type `[[` and LoreLinks
suggests the notes and characters you can link to. Open the graph to see how everything connects.

## Features

- **Wikilinks** – `[[Note]]` links to the journal entry, page, actor or item with that name. Matching ignores case
  and accents. When names clash, journal entries win, then actors, then items; write `[[Actor:Name]]` or
  `[[Item:Name]]` to pick one explicitly (autocomplete adds the prefix for you).
- **Characters and items as notes** – links work in actor biographies, item descriptions and other rich-text
  fields, in any game system, and `[[Character Name]]` opens the character sheet.
- **Rename-safe** – when a note, page, actor or item is renamed, LoreLinks rewrites the links that point to it,
  keeping prefixes, `#sections` and `|aliases`. The **Update links when renaming** setting chooses between asking each
  time (default), always updating, or never.
- **Sections and aliases** – `[[Note#Page]]` links to a page inside a note, `[[Note|shown text]]` changes the text.
- **Autocomplete** – type `[[` in any rich-text editor (journals, biographies) to pick a note or actor with the arrow
  keys and Enter.
- **Graph view** – notes and actors as dots, links as lines. Zoom with the mouse wheel, drag to pan or move dots,
  hover to highlight connections, search by name, and click a dot to open it. Open it from the **Graph** button in
  the Journal, Actors or Items sidebar, or with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>.
- **Unresolved links** – links to notes that do not exist yet are shown dashed; clicking one creates the note.
- **Respects permissions** – players see plain text instead of a link when they cannot view the target, and the graph
  only shows what the viewing user is allowed to see.
- **Obsidian export** – download your journal (and optionally actors and items) as a zipped Obsidian vault: one
  Markdown file per note, pages as headings, `[[links]]` and `@UUID` links as Obsidian links, secret blocks as
  `> [!secret]` callouts, and images copied into `attachments/`.
- **Obsidian import** – pick a vault folder (or some Markdown files) to create journal entries. Folders become journal
  folders, embedded images are uploaded, callouts and highlights are converted, and notes exported by LoreLinks
  update their original entries instead of creating copies.
- Works anywhere Foundry renders rich text: journals, actor biographies, item descriptions and chat.

Inline rolls such as `[[1d20]]` and commands such as `[[/r 2d6]]` or `[[/check dex]]` keep working as before.

## Installation

In Foundry's **Add-on Modules** tab, choose **Install Module** and paste this manifest URL:

```
https://github.com/gioguarnieri/lorelinks/releases/latest/download/module.json
```

Requires Foundry VTT version 14.

## Obsidian round trips

Export and import are in the Journal sidebar header (GM only). Each exported note starts with frontmatter such as
`foundry-uuid`, which lets a later import update the same journal entry. Actor and item notes are exported for
reference and linking, but are not imported back. Foundry `@UUID` links come back as `[[wikilinks]]`, and images come
back as uploaded copies in `worlds/<world>/lorelinks-obsidian/`.

## Roadmap

- Backlinks panel listing the notes that link to the current one (the index already tracks backlinks)
- Local graph centered on the open note
- Links inside items owned by actors (currently only world items are indexed)
- Autocomplete in Markdown pages

## Development

Clone the repository into your Foundry `Data/modules` folder (or symlink it there) as `lorelinks`, then enable the
module in a world. The code is plain ES modules with no build step.

Releases are built by GitHub Actions: publishing a GitHub release tagged `vX.Y.Z` produces `module.json` and
`lorelinks.zip` with matching version and download URLs.

## License

[MIT](LICENSE)
