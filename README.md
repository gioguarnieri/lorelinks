# LoreLinks

Obsidian-style `[[wikilinks]]` for [Foundry Virtual Tabletop](https://foundryvtt.com) journals.

Write `[[Name of a note]]` in any journal page and it becomes a link. Type `[[` and LoreLinks suggests the notes you can
link to.

## Features

- **Wikilinks** – `[[Note]]` links to the journal entry (or page) with that name. Matching ignores case and accents.
- **Sections and aliases** – `[[Note#Page]]` links to a page inside a note, `[[Note|shown text]]` changes the text.
- **Autocomplete** – type `[[` in the journal editor to pick from your notes with the arrow keys and Enter.
- **Unresolved links** – links to notes that do not exist yet are shown dashed; clicking one creates the note.
- **Respects permissions** – players see plain text instead of a link when they cannot view the target note.
- Works anywhere Foundry renders rich text: journals, actor biographies, item descriptions and chat.

Inline rolls such as `[[1d20]]` and commands such as `[[/r 2d6]]` or `[[/check dex]]` keep working as before.

## Installation

In Foundry's **Add-on Modules** tab, choose **Install Module** and paste this manifest URL:

```
https://github.com/gioguarnieri/lorelinks/releases/latest/download/module.json
```

Requires Foundry VTT version 14.

## Roadmap

- Backlinks panel listing the notes that link to the current one
- Graph view of how notes connect
- Updating links automatically when a note is renamed
- Autocomplete in Markdown pages

## Development

Clone the repository into your Foundry `Data/modules` folder (or symlink it there) as `lorelinks`, then enable the
module in a world. The code is plain ES modules with no build step.

Releases are built by GitHub Actions: publishing a GitHub release tagged `vX.Y.Z` produces `module.json` and
`lorelinks.zip` with matching version and download URLs.

## License

[MIT](LICENSE)
