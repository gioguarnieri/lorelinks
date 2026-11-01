export const MODULE_ID = "lorelinks";

/**
 * Matches [[Target]], [[Target#Section]], [[Target|Alias]] and [[Target#Section|Alias]].
 * Capture groups: 1 = target, 2 = section (optional), 3 = alias (optional).
 */
export const WIKILINK_PATTERN = /\[\[([^\[\]|#]+?)(?:#([^\[\]|]+?))?(?:\|([^\[\]]+?))?\]\]/g;

/** Maximum number of suggestions shown in the autocomplete menu. */
export const MAX_SUGGESTIONS = 12;
