/** Top-level vault folders written by the export and recognized by the import. */
export const TOP_FOLDERS = { JournalEntry: "Journal", Actor: "Actors", Item: "Items", attachments: "attachments" };

/** @type {showdown.Converter} */
let instance;

/**
 * Foundry's own HTML <-> Markdown converter (showdown, configured with Foundry's options).
 * @returns {showdown.Converter}
 */
export function converter() {
  instance ??= new window.showdown.Converter();
  return instance;
}

/**
 * A file or folder name that works on every operating system and in Obsidian links.
 * @param {string} name
 * @param {string} fallback  Used when nothing is left after cleaning.
 * @returns {string}
 */
export function sanitizeFileName(name, fallback) {
  const clean = String(name ?? "").replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "");
  return clean || fallback;
}

/**
 * A YAML frontmatter block. Strings are written as JSON strings, which YAML reads as quoted strings.
 * @param {Record<string, string|boolean|string[]>} meta
 * @returns {string}
 */
export function frontmatter(meta) {
  const lines = ["---"];
  for ( const [key, value] of Object.entries(meta) ) {
    if ( Array.isArray(value) ) lines.push(`${key}:`, ...value.map(v => `  - ${JSON.stringify(v)}`));
    else lines.push(`${key}: ${typeof value === "string" ? JSON.stringify(value) : value}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

/**
 * Split a note into its frontmatter and body. Understands the simple "key: value" and list forms Obsidian writes.
 * @param {string} text
 * @returns {{meta: Record<string, any>, body: string}}
 */
export function parseFrontmatter(text) {
  text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if ( !match ) return { meta: {}, body: text };
  const meta = {};
  let listKey = null;
  const value = raw => {
    raw = raw.trim();
    if ( /^".*"$/.test(raw) ) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw.slice(1, -1);
      }
    }
    if ( /^'.*'$/.test(raw) ) return raw.slice(1, -1).replace(/''/g, "'");
    if ( raw === "true" ) return true;
    if ( raw === "false" ) return false;
    return raw;
  };
  for ( const line of match[1].split("\n") ) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if ( item && listKey ) {
      meta[listKey].push(value(item[1]));
      continue;
    }
    const pair = line.match(/^([\w-]+):\s*(.*)$/);
    if ( !pair ) continue;
    const [, key, raw] = pair;
    if ( raw.trim() === "" ) {
      meta[key] = [];
      listKey = key;
    } else {
      meta[key] = /^\[.*\]$/.test(raw.trim()) ? raw.trim().slice(1, -1).split(",").map(v => value(v)).filter(Boolean)
        : value(raw);
      listKey = null;
    }
  }
  return { meta, body: text.slice(match[0].length) };
}
