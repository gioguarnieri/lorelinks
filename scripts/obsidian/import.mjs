import { normalizeName } from "../wikilinks.mjs";
import { converter, parseFrontmatter, sanitizeFileName, TOP_FOLDERS } from "./shared.mjs";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;

/** Where uploaded images go, inside the world's folder. */
const UPLOAD_FOLDER = () => `worlds/${game.world.id}/lorelinks-obsidian`;

/**
 * @typedef VaultNote
 * @property {string} name                 The journal entry name.
 * @property {string[]} folders            Folder names from the vault root down to the note.
 * @property {Record<string, any>} meta    Frontmatter.
 * @property {{name: string, markdown: string}[]} pages
 */

/**
 * @typedef ImportResult
 * @property {number} created
 * @property {number} updated
 * @property {number} skipped     Actor and item notes, which are not imported.
 * @property {number} images
 * @property {string[]} failedImages
 */

/**
 * The path of a selected file inside the vault, without the vault folder itself.
 * @param {File} file
 * @returns {string[]}
 */
function vaultPath(file) {
  const parts = (file.webkitRelativePath || file.name).split("/");
  return file.webkitRelativePath ? parts.slice(1) : parts;
}

/**
 * Split a note written with one top-level heading per page back into pages, promoting the headings inside each page.
 * @param {string} body
 * @param {string} noteName  Used for text before the first heading.
 * @returns {{name: string, markdown: string}[]}
 */
function splitPages(body, noteName) {
  const pages = [];
  let current = { name: noteName, lines: [] };
  let fenced = false;
  for ( const line of body.split("\n") ) {
    if ( /^(```|~~~)/.test(line) ) fenced = !fenced;
    const heading = !fenced && line.match(/^# (.+)$/);
    if ( heading ) {
      if ( current.lines.join("").trim() || pages.length || (current.name !== noteName) ) pages.push(current);
      current = { name: heading[1].trim(), lines: [] };
      continue;
    }
    current.lines.push((!fenced && /^#{2,6} /.test(line)) ? line.slice(1) : line);
  }
  pages.push(current);
  return pages.filter(p => p.lines.join("").trim() || (pages.length === 1)).map(p => ({
    name: p.name, markdown: p.lines.join("\n").trim()
  }));
}

/**
 * State shared while one vault is imported.
 */
class ImportContext {
  /**
   * @param {File[]} files  Every selected file, used to find embedded images.
   */
  constructor(files) {
    for ( const file of files ) {
      const name = file.name.toLowerCase();
      if ( IMAGE_EXTENSIONS.test(name) && !this.images.has(name) ) this.images.set(name, file);
    }
  }

  /** @type {Map<string, File>} Image files keyed by lower-cased file name. */
  images = new Map();

  /** @type {Map<string, string>} Note names keyed by their lower-cased file name, for notes renamed by the export. */
  names = new Map();

  /** @type {Map<string, string>} Uploaded image paths keyed by lower-cased file name. */
  uploaded = new Map();

  failedImages = [];

  /**
   * Upload an embedded image once and return its path in Foundry.
   * @param {string} name  The file name used in the embed.
   * @returns {Promise<string|null>}
   */
  async upload(name) {
    const key = name.split("/").pop().toLowerCase();
    if ( this.uploaded.has(key) ) return this.uploaded.get(key);
    const file = this.images.get(key);
    if ( !file ) return null;
    try {
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      if ( !this.folderReady ) {
        await FilePicker.createDirectory("data", UPLOAD_FOLDER()).catch(() => {});
        this.folderReady = true;
      }
      const result = await FilePicker.upload("data", UPLOAD_FOLDER(), file, {}, { notify: false });
      if ( !result?.path ) throw new Error("Upload failed");
      this.uploaded.set(key, result.path);
      return result.path;
    } catch {
      this.failedImages.push(name);
      this.uploaded.set(key, null);
      return null;
    }
  }
}

/**
 * Turn one Obsidian link target into a LoreLinks target: drop folder paths and block references, map the exported
 * Actors/ and Items/ folders to type prefixes, and restore names the export had to change for the file system.
 * @param {string} target   Everything before the | of the link.
 * @param {ImportContext} ctx
 * @returns {string}
 */
function convertTarget(target, ctx) {
  let [path, fragment] = target.split(/#(.*)/s);
  if ( fragment?.startsWith("^") ) fragment = undefined;
  const parts = path.split("/").map(p => p.trim()).filter(Boolean);
  let prefix = "";
  if ( parts.length > 1 ) {
    if ( parts[0] === TOP_FOLDERS.Actor ) prefix = "Actor:";
    else if ( parts[0] === TOP_FOLDERS.Item ) prefix = "Item:";
  }
  let name = (parts.at(-1) ?? path).replace(/\.md$/i, "");
  name = ctx.names.get(name.toLowerCase()) ?? name;
  return `${prefix}${name}${fragment ? `#${fragment}` : ""}`;
}

/**
 * Convert Obsidian Markdown to Foundry HTML.
 * @param {string} markdown
 * @param {ImportContext} ctx
 * @returns {Promise<string>}
 */
async function markdownToHtml(markdown, ctx) {
  const tokens = new Map();
  const token = html => {
    const t = `LORELINKSTOKEN${tokens.size}END`;
    tokens.set(t, html);
    return t;
  };

  // Inline rolls the export wrapped in code become rolls again.
  markdown = markdown.replace(/`(\[\[[^`\n]*?\]\])`/g, "$1");

  // Image embeds are uploaded; embeds of other notes become links.
  const embeds = [...markdown.matchAll(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g)];
  const replacements = new Map();
  for ( const [raw, target, size] of embeds ) {
    if ( replacements.has(raw) ) continue;
    if ( !IMAGE_EXTENSIONS.test(target.trim()) ) {
      replacements.set(raw, `[[${target.trim()}]]`);
      continue;
    }
    const path = await ctx.upload(target.trim());
    const width = size?.match(/^\s*(\d+)/)?.[1];
    replacements.set(raw, path ? token(`<img src="${path}"${width ? ` width="${width}"` : ""}>`) : `*${target.trim()}*`);
  }
  for ( const [raw, value] of replacements ) markdown = markdown.split(raw).join(value);

  // Wikilinks keep their alias; paths and block references are simplified.
  markdown = markdown.replace(/\[\[([^\[\]|]+?)(\|[^\[\]]*?)?\]\]/g, (raw, target, alias) => {
    if ( target.trim().startsWith("/") ) return raw;
    return `[[${convertTarget(target.trim(), ctx)}${alias ?? ""}]]`;
  });

  // Callouts: [!secret] becomes a Foundry secret block, other types a blockquote with a bold title.
  markdown = await replaceCallouts(markdown, ctx, token);

  // Obsidian highlights.
  markdown = markdown.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");

  let html = converter().makeHtml(markdown);
  for ( const [t, value] of tokens ) {
    html = html.replace(new RegExp(`<p>${t}</p>`, "g"), value).split(t).join(value);
  }
  return html;
}

/**
 * Replace Obsidian callouts ("> [!type] Title" followed by "> " lines).
 * @param {string} markdown
 * @param {ImportContext} ctx
 * @param {function(string): string} token
 * @returns {Promise<string>}
 */
async function replaceCallouts(markdown, ctx, token) {
  const lines = markdown.split("\n");
  const out = [];
  for ( let i = 0; i < lines.length; i++ ) {
    const start = lines[i].match(/^>\s*\[!(\w+)\][+-]?\s*(.*)$/);
    if ( !start ) {
      out.push(lines[i]);
      continue;
    }
    const body = [];
    while ( (i + 1 < lines.length) && /^>/.test(lines[i + 1]) ) body.push(lines[++i].replace(/^>\s?/, ""));
    const [, type, title] = start;
    const inner = await markdownToHtml(body.join("\n"), ctx);
    if ( type.toLowerCase() === "secret" ) {
      out.push("", token(`<section class="secret" id="secret-${foundry.utils.randomID()}">${inner}</section>`), "");
    } else {
      const heading = title || (type.charAt(0).toUpperCase() + type.slice(1));
      out.push("", token(`<blockquote><p><strong>${foundry.utils.escapeHTML(heading)}</strong></p>${inner}</blockquote>`), "");
    }
  }
  return out.join("\n");
}

/**
 * Find or create the journal folder for a list of folder names.
 * @param {string[]} names
 * @param {Map<string, Folder>} cache
 * @returns {Promise<Folder|null>}
 */
async function ensureFolder(names, cache) {
  let parent = null;
  for ( let i = 0; i < names.length; i++ ) {
    const key = names.slice(0, i + 1).join("/");
    let folder = cache.get(key);
    if ( !folder ) {
      folder = game.folders.find(f => (f.type === "JournalEntry") && (f.name === names[i]) && ((f.folder ?? null) === parent));
      folder ??= await Folder.implementation.create({ name: names[i], type: "JournalEntry", folder: parent?.id ?? null });
      cache.set(key, folder);
    }
    parent = folder;
  }
  return parent;
}

/**
 * Read the selected files into notes.
 * @param {File[]} files
 * @param {ImportContext} ctx
 * @returns {Promise<{notes: VaultNote[], skipped: number}>}
 */
async function readNotes(files, ctx) {
  const notes = [];
  let skipped = 0;
  for ( const file of files ) {
    const path = vaultPath(file);
    if ( !/\.md$/i.test(file.name) || path.some(p => p.startsWith(".")) ) continue;
    const { meta, body } = parseFrontmatter(await file.text());
    if ( ["Actor", "Item"].includes(meta["foundry-type"]) ) {
      skipped++;
      continue;
    }
    const basename = file.name.replace(/\.md$/i, "");
    const name = (typeof meta["foundry-name"] === "string" && meta["foundry-name"]) || basename;
    if ( name !== basename ) ctx.names.set(basename.toLowerCase(), name);

    let folders = path.slice(0, -1);
    if ( folders[0] === TOP_FOLDERS.JournalEntry ) folders = folders.slice(1);
    const pages = meta["foundry-pages"] ? splitPages(body, name) : [{ name, markdown: body.trim() }];
    notes.push({ name, folders, meta, pages });
  }
  return { notes, skipped };
}

/**
 * Import an Obsidian vault (or some of its notes) as journal entries.
 * @param {File[]} files                     Files from a folder or file picker.
 * @param {object} [options]
 * @param {boolean} [options.folders=true]   Recreate the vault's folders as journal folders.
 * @param {boolean} [options.update=true]    Update notes that already exist instead of creating copies.
 * @param {function(number, number): void} [options.onProgress]
 * @returns {Promise<ImportResult>}
 */
export async function importVault(files, { folders = true, update = true, onProgress } = {}) {
  const ctx = new ImportContext(files);
  const { notes, skipped } = await readNotes(files, ctx);
  const folderCache = new Map();
  const result = { created: 0, updated: 0, skipped, images: 0, failedImages: ctx.failedImages };

  for ( const [index, note] of notes.entries() ) {
    onProgress?.(index, notes.length);
    const folder = folders ? await ensureFolder(note.folders.map(f => sanitizeFileName(f, "Folder")), folderCache) : null;
    const pages = [];
    for ( const page of note.pages ) {
      pages.push({ name: page.name, type: "text", text: { content: await markdownToHtml(page.markdown, ctx),
        format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } });
    }

    let existing = null;
    if ( update ) {
      const byUuid = note.meta["foundry-uuid"] ? fromUuidSync(note.meta["foundry-uuid"]) : null;
      existing = (byUuid instanceof JournalEntry) ? byUuid
        : game.journal.find(j => (normalizeName(j.name) === normalizeName(note.name)) && ((j.folder ?? null) === folder));
    }

    if ( existing ) {
      const changes = [];
      const additions = [];
      for ( const page of pages ) {
        // Image, PDF and video pages come back from Obsidian as text; keep the originals rather than duplicating them.
        const match = existing.pages.find(p => normalizeName(p.name) === normalizeName(page.name));
        if ( match?.type === "text" ) changes.push({ _id: match.id, text: page.text });
        else if ( !match ) additions.push(page);
      }
      if ( changes.length ) await existing.updateEmbeddedDocuments("JournalEntryPage", changes);
      if ( additions.length ) await existing.createEmbeddedDocuments("JournalEntryPage", additions);
      result.updated++;
    } else {
      await JournalEntry.implementation.create({ name: note.name, folder: folder?.id ?? null, pages });
      result.created++;
    }
  }
  onProgress?.(notes.length, notes.length);
  result.images = [...ctx.uploaded.values()].filter(Boolean).length;
  return result;
}
