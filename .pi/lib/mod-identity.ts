/**
 * The descriptor.mod parser and identity. mod-lint and mod-install share this copy, so the two
 * cannot drift apart: it is the single source of truth for the `descriptor.mod` format.
 *
 * Game rule (the CK3 wiki Mod_structure page): a mod is identified by the `name` key in its
 * `descriptor.mod`, and `version` is a required string. The `<name>.mod` file alongside the mod
 * directory holds the same keys plus `path`. This file reads `descriptor.mod`, the copy inside the
 * mod folder.
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
  /** The `tags={ "a" "b" }` list entries. */
  tags: string[];
}

/** Strips a `#` line comment that is outside a quoted string. Keeps the rest of the line. */
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
 * `#` comment outside quotes first, so `name="X" # note` parses the same as `name="X"`. A line that
 * is neither `key="value"` nor `key={ ... }` is skipped, so a malformed line is simply absent from
 * the result; the caller decides whether that is an error.
 */
export function parseDescriptorMod(text: string): DescriptorMod {
  const scalars = new Map<string, string>();
  const tags: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"\s*$/.exec(line);
    if (kv) {
      scalars.set(kv[1], kv[2]);
      continue;
    }
    const list = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{\s*(.*?)\s*\}\s*$/.exec(line);
    if (list && list[1] === "tags") {
      for (const m of list[2].matchAll(/"([^"]*)"/g)) tags.push(m[1]);
    }
  }
  return { scalars, tags };
}

/**
 * Read the name, the version, and the supported_version from `descriptor.mod` (the CK3 key=value
 * descriptor inside the mod folder). Returns null when the file is absent, unreadable, or the
 * `name` key is missing or empty. `version` and `supported_version` may be absent and are then the
 * empty string; the linter enforces them.
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
