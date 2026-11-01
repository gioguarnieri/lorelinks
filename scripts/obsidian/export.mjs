import { WIKILINK_PATTERN } from "../constants.mjs";
import { isForeignSyntax, parseWikilink, resolveWikilink } from "../wikilinks.mjs";
import { textFields } from "../link-index.mjs";
import { createZip, downloadBlob } from "./zip.mjs";
import { converter, frontmatter, sanitizeFileName, TOP_FOLDERS } from "./shared.mjs";

/**
 * @typedef ExportedFile
 * @property {string} path       Vault-relative path without the .md extension, e.g. "Journal/Places/Valpúrgis".
 * @property {string} basename   File name without the extension.
 * @property {boolean} headings  Whether the note's pages are written as top-level headings.
 */

/**
 * State shared while one vault is being written.
 */
class ExportContext {
  constructor({ images }) {
    this.images = images;
  }

  /** Whether secret blocks are exported for the document being written; only owners can see them in Foundry. */
  secrets = false;

  /** @type {Map<string, ExportedFile>} Exported files keyed by document UUID. */
  files = new Map();

  /** @type {Map<string, number>} How many exported files share each lower-cased basename. */
  basenameCounts = new Map();

  /** @type {Map<string, string>} Attachment file names keyed by the image path in Foundry. */
  attachments = new Map();

  /** @type {Map<string, string>} Placeholder tokens and the Markdown they stand for. */
  tokens = new Map();

  /**
   * A placeholder that survives HTML-to-Markdown conversion untouched.
   * @param {string} markdown
   * @returns {string}
   */
  token(markdown) {
    const token = `LORELINKSTOKEN${this.tokens.size}END`;
    this.tokens.set(token, markdown);
    return token;
  }

  /**
   * Replace placeholder tokens with their Markdown. Tokens can contain other tokens (secrets inside secrets).
   * @param {string} text
   * @returns {string}
   */
  restore(text) {
    let previous;
    do {
      previous = text;
      text = text.replace(/LORELINKSTOKEN\d+END/g, t => this.tokens.get(t) ?? t);
    } while ( text !== previous );
    return text;
  }

  /**
   * The vault file name for an image, registering it for download.
   * @param {string} src
   * @returns {string|null}  The attachment file name, or null when the image stays a URL.
   */
  attach(src) {
    if ( !this.images || !src || /^(https?:|data:)/i.test(src) ) return null;
    if ( this.attachments.has(src) ) return this.attachments.get(src);
    const decoded = decodeURIComponent(src.split(/[?#]/)[0]);
    const base = sanitizeFileName(decoded.split("/").pop(), "image");
    let name = base;
    const taken = new Set(this.attachments.values());
    for ( let n = 2; taken.has(name); n++ ) name = base.replace(/(\.[^.]*)?$/, ` ${n}$1`);
    this.attachments.set(src, name);
    return name;
  }

  /**
   * An Obsidian wikilink to an exported document. Uses the bare file name when it is unique in the vault, and the
   * vault path otherwise, so Obsidian never picks the wrong note.
   * @param {foundry.abstract.Document} doc      The link target (an entry, page, actor or item).
   * @param {string} display                     The text the link showed in Foundry.
   * @param {string} [alias]                     An explicit alias from the original link.
   * @returns {string|null}                      Null when the target is not part of the export.
   */
  linkTo(doc, display, alias) {
    const page = doc instanceof JournalEntryPage ? doc : null;
    const file = this.files.get((page?.parent ?? doc).uuid);
    if ( !file ) return null;
    const unique = this.basenameCounts.get(file.basename.toLowerCase()) === 1;
    const target = unique ? file.basename : file.path;
    const heading = (page && file.headings) ? `#${page.name.replace(/[#|[\]]/g, " ")}` : "";
    const shown = alias ?? display;
    return (shown && (shown !== target)) ? `[[${target}${heading}|${shown}]]` : `[[${target}${heading}]]`;
  }
}

/**
 * Convert the links in a piece of text: LoreLinks wikilinks and Foundry @UUID links become Obsidian links, and
 * inline rolls or commands become inline code so Obsidian does not show them as broken links.
 * @param {string} text
 * @param {ExportContext} ctx
 * @param {boolean} tokens   Wrap results in placeholder tokens (for text that is converted from HTML afterwards).
 * @returns {string}
 */
function convertLinks(text, ctx, tokens) {
  const out = md => (tokens ? ctx.token(md) : md);
  text = text.replace(WIKILINK_PATTERN, (raw, ...groups) => {
    const link = parseWikilink([raw, ...groups]);
    if ( isForeignSyntax(link.target) ) return out(`\`${raw}\``);
    const doc = resolveWikilink(link);
    const converted = doc && ctx.linkTo(doc, link.target, link.alias);
    return converted ? out(converted) : out(raw);
  });
  return text.replace(/@UUID\[([^\]]+)\](?:\{([^}]+)\})?/g, (raw, uuid, label) => {
    const doc = fromUuidSync(uuid);
    const display = label ?? doc?.name ?? uuid;
    const converted = doc && ctx.linkTo(doc, display);
    return converted ? out(converted) : display;
  });
}

/**
 * Convert Foundry HTML to Obsidian Markdown.
 * @param {string} html
 * @param {ExportContext} ctx
 * @returns {string}
 */
function htmlToMarkdown(html, ctx) {
  const root = document.createElement("div");
  root.innerHTML = html ?? "";

  // Secret blocks become callouts, or are dropped for users who cannot see them. Innermost first.
  for ( const secret of [...root.querySelectorAll("section.secret")].reverse() ) {
    if ( !ctx.secrets ) {
      secret.remove();
      continue;
    }
    const inner = htmlToMarkdown(secret.innerHTML, ctx).trim();
    const callout = ["> [!secret]", ...inner.split("\n").map(line => `> ${line}`)].join("\n");
    const p = document.createElement("p");
    p.textContent = ctx.token(callout);
    secret.replaceWith(p);
  }

  // Images become attachment embeds, keeping their width (![[image.png|64]]).
  for ( const img of root.querySelectorAll("img") ) {
    const name = ctx.attach(img.getAttribute("src"));
    const width = parseInt(img.getAttribute("width"));
    if ( name ) img.replaceWith(document.createTextNode(ctx.token(`![[${name}${width ? `|${width}` : ""}]]`)));
  }

  // Links live in text nodes.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
    if ( node.textContent.includes("[[") || node.textContent.includes("@UUID") ) {
      node.textContent = convertLinks(node.textContent, ctx, true);
    }
  }

  return ctx.restore(converter().makeMarkdown(root.innerHTML)).replace(/<!-- -->\n?/g, "").trim();
}

/**
 * Push Markdown headings one level down, so pages can be top-level headings of their note.
 * @param {string} markdown
 * @returns {string}
 */
function demoteHeadings(markdown) {
  let fenced = false;
  return markdown.split("\n").map(line => {
    if ( /^(```|~~~)/.test(line) ) fenced = !fenced;
    return (!fenced && /^#{1,5} /.test(line)) ? `#${line}` : line;
  }).join("\n");
}

/**
 * The Markdown body of one journal page.
 * @param {JournalEntryPage} page
 * @param {ExportContext} ctx
 * @returns {string}
 */
function pageMarkdown(page, ctx) {
  switch ( page.type ) {
    case "text": {
      const markdownFormat = page.text.format === CONST.JOURNAL_ENTRY_PAGE_FORMATS.MARKDOWN;
      if ( markdownFormat && page.text.markdown ) return convertLinks(page.text.markdown, ctx, false);
      return htmlToMarkdown(page.text.content, ctx);
    }
    case "image": {
      const name = ctx.attach(page.src);
      const image = name ? `![[${name}]]` : `![${page.name}](${page.src ?? ""})`;
      return page.image?.caption ? `${image}\n\n*${page.image.caption}*` : image;
    }
    default:
      return page.src ? `[${page.name}](${page.src})` : "";
  }
}

/**
 * A readable heading for an actor or item field path, e.g. "system.details.biography.value" → "Biography".
 * @param {string} path
 * @returns {string}
 */
function fieldHeading(path) {
  const parts = path.split(".").filter(p => !["system", "value"].includes(p));
  const name = parts.at(-1) ?? path;
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * The full Markdown file for a journal entry, actor or item.
 * @param {JournalEntry|Actor|Item} doc
 * @param {ExportContext} ctx
 * @returns {string}
 */
function noteMarkdown(doc, ctx) {
  const file = ctx.files.get(doc.uuid);
  const meta = { "foundry-uuid": doc.uuid, "foundry-type": doc.documentName, "foundry-name": doc.name };
  if ( file.basename !== doc.name ) meta.aliases = [doc.name];
  if ( file.headings ) meta["foundry-pages"] = true;

  const sections = [];
  if ( doc instanceof JournalEntry ) {
    const pages = doc.pages.contents.filter(p => p.testUserPermission(game.user, "LIMITED"))
      .sort((a, b) => a.sort - b.sort);
    for ( const page of pages ) {
      ctx.secrets = page.isOwner;
      const body = pageMarkdown(page, ctx);
      sections.push(file.headings ? `# ${page.name}\n\n${demoteHeadings(body)}` : body);
    }
  } else {
    // Portraits are worth exporting; the default icons of Foundry and game systems are not.
    const isDefaultIcon = !doc.img || /^(icons|systems)\//.test(doc.img);
    const portrait = !isDefaultIcon && ctx.attach(doc.img);
    if ( portrait ) sections.push(`![[${portrait}|200]]`);
    ctx.secrets = doc.isOwner;
    const fields = textFields(doc);
    for ( const field of fields ) {
      const body = htmlToMarkdown(field.value, ctx);
      if ( !body ) continue;
      sections.push(fields.length > 1 ? `## ${fieldHeading(field.path)}\n\n${body}` : body);
    }
  }
  return `${frontmatter(meta)}\n${sections.filter(Boolean).join("\n\n")}\n`;
}

/**
 * The vault folder path of a document's Foundry folder, e.g. "Places/Cities".
 * @param {foundry.abstract.Document} doc
 * @returns {string[]}
 */
function folderPath(doc) {
  const names = [];
  for ( let folder = doc.folder; folder; folder = folder.folder ) names.unshift(sanitizeFileName(folder.name, "Folder"));
  return names;
}

/**
 * Export journal entries (and optionally actors and items) as a zipped Obsidian vault and download it.
 * Only documents the current user can see are exported; secret blocks only when the user owns the page.
 * @param {object} [options]
 * @param {boolean} [options.actors=true]   Include actors as notes.
 * @param {boolean} [options.items=true]    Include world items as notes.
 * @param {boolean} [options.images=true]   Copy images into the vault's attachments folder.
 * @returns {Promise<{notes: number, images: number, missingImages: number}>}
 */
export async function exportVault({ actors = true, items = true, images = true } = {}) {
  const ctx = new ExportContext({ images });
  const visible = doc => doc.testUserPermission(game.user, "LIMITED");
  const docs = [
    ...game.journal.filter(visible),
    ...(actors ? game.actors.filter(visible) : []),
    ...(items ? game.items.filter(visible) : [])
  ];

  // Plan every file first, so links can be written knowing all names.
  const taken = new Set();
  for ( const doc of docs ) {
    const dir = [TOP_FOLDERS[doc.documentName], ...folderPath(doc)].join("/");
    const base = sanitizeFileName(doc.name, "Untitled");
    let basename = base;
    for ( let n = 2; taken.has(`${dir}/${basename}`.toLowerCase()); n++ ) basename = `${base} ${n}`;
    taken.add(`${dir}/${basename}`.toLowerCase());
    const pages = doc instanceof JournalEntry ? doc.pages.filter(visible) : [];
    const headings = (pages.length > 1) || ((pages.length === 1) && (pages[0].name !== doc.name));
    ctx.files.set(doc.uuid, { path: `${dir}/${basename}`, basename, headings });
    const key = basename.toLowerCase();
    ctx.basenameCounts.set(key, (ctx.basenameCounts.get(key) ?? 0) + 1);
  }

  const encoder = new TextEncoder();
  const vault = sanitizeFileName(game.world.title, "Foundry");
  const files = [];
  for ( const doc of docs ) {
    files.push({ path: `${vault}/${ctx.files.get(doc.uuid).path}.md`, data: encoder.encode(noteMarkdown(doc, ctx)) });
  }

  let missingImages = 0;
  for ( const [src, name] of ctx.attachments ) {
    try {
      const response = await fetch(new URL(src, `${window.location.origin}${foundry.utils.getRoute("/")}`));
      if ( !response.ok ) throw new Error(response.statusText);
      files.push({ path: `${vault}/${TOP_FOLDERS.attachments}/${name}`, data: new Uint8Array(await response.arrayBuffer()) });
    } catch {
      missingImages++;
    }
  }

  downloadBlob(createZip(files), `${vault}.zip`);
  return { notes: docs.length, images: ctx.attachments.size - missingImages, missingImages };
}
