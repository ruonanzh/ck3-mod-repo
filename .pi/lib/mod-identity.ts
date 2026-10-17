/**
 * The descriptor.mod parser and identity. mod-lint and mod-install share this copy, so the two
 * cannot drift apart: it is the single source of truth for the `descriptor.mod` format.
 *
 * Game rule (the CK3 wiki Mod_structure page): a mod is identified by the `name` key in its
 * `descriptor.mod`, and `version` is a required string. The `<name>.mod` file alongside the mod
 * directory holds the same keys plus `path`. This file reads `descriptor.mod`, the copy inside the
 * mod folder.
 *
 * Format: `key="value"` for a scalar, and `key={ "a" "b" }` for a list. A list may span several
 * lines, which real workshop mods do:
 *
 *     tags={
 *     	"Gameplay"
 *     	"Balance"
 *     }
 *
 * A `#` starts a comment outside a string.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The id check. Game rule: a non-empty string. */
export const isValidModId = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export interface ModIdentity {
  name: string;
  version: string;
  supportedVersion: string;
}

export interface DescriptorMod {
  /** The `key="value"` scalar entries, keyed by the key name. */
  scalars: Map<string, string>;
  /** The list entries, keyed by the key name: `tags`, and any other `key={ ... }` block. */
  lists: Map<string, string[]>;
  /** The entries of the `tags` list, or an empty array. */
  tags: string[];
  /** True when the text declares `tags=` but the value does not parse as a list of quoted strings. */
  tagsMalformed: boolean;
}

/** Strips a `#` line comment that is outside a quoted string. Comments do not span lines. */
function stripComment(line: string): string {
  let out = "";
  let inString = false;
  for (const ch of line) {
    if (inString) {
      out += ch;
      if (ch === '"') inString = false;
    } else if (ch === "#") {
      break;
    } else {
      out += ch;
      if (ch === '"') inString = true;
    }
  }
  return out;
}

/**
 * Parses a `descriptor.mod` (or `<name>.mod`) text into its scalar and list entries. It strips a
 * `#` comment outside quotes first, so `name="X" # note` parses the same as `name="X"`. An entry it
 * cannot parse is simply absent from the result, except `tags`, where `tagsMalformed` records the
 * problem; the caller decides whether that is an error.
 */
export function parseDescriptorMod(text: string): DescriptorMod {
  const cleaned = text
    .split(/\r?\n/)
    .map(stripComment)
    .join("\n");
  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();

  // Collect the list entries first, then blank them out, so a scalar scan cannot read a line that
  // sits inside a multi-line list.
  let rest = cleaned;
  const listRe = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{([^{}]*)\}/g;
  let tagsInner: string | null = null;
  for (const m of cleaned.matchAll(listRe)) {
    const entries: string[] = [];
    for (const q of m[2].matchAll(/"([^"]*)"/g)) entries.push(q[1]);
    lists.set(m[1], entries);
    if (m[1] === "tags") tagsInner = m[2];
    const span = m[0].length;
    const start = m.index ?? 0;
    rest = `${rest.slice(0, start)}${" ".repeat(span)}${rest.slice(start + span)}`;
  }

  const scalarRe = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*"([^"]*)"[ \t]*$/gm;
  for (const m of rest.matchAll(scalarRe)) scalars.set(m[1], m[2]);

  const tags = lists.get("tags") ?? [];
  // `tags={}` is valid (an empty list). Only a block with content that holds no quoted string is
  // malformed, as in `tags={ Gameplay }`. An unclosed block (`tags={ "A"`) never matches the list
  // pattern, and the brace balance check already reports it.
  const tagsMalformed = tagsInner !== null && tagsInner.trim() !== "" && tags.length === 0;
  return { scalars, lists, tags, tagsMalformed };
}

/**
 * Read the name, the version, and the supported_version from `descriptor.mod` (the CK3 key=value
 * descriptor inside the mod folder). Returns null when the file is absent, unreadable, or the
 * `name` key is missing or empty. `version` and `supported_version` may be absent and are then the
 * empty string; the linter enforces `version`.
 */
export function readModIdentity(modDir: string): ModIdentity | null {
  const descriptorPath = join(modDir, "descriptor.mod");
  if (!existsSync(descriptorPath)) return null;
  let text: string;
  try {
    text = readFileSync(descriptorPath, "utf8");
  } catch {
    return null;
  }
  const { scalars } = parseDescriptorMod(text);
  const name = (scalars.get("name") ?? "").trim();
  if (!isValidModId(name)) return null;
  return {
    name,
    version: (scalars.get("version") ?? "").trim(),
    supportedVersion: (scalars.get("supported_version") ?? "").trim(),
  };
}
