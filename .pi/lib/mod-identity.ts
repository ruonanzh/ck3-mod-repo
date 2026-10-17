/**
 * The mod identity check. mod-install reads this copy to name the install and to build the
 * launcher pointer file.
 *
 * Game rule (the CK3 wiki Mod_structure page): a mod is identified by the `name` key in its
 * `descriptor.mod`, and `version` is a required string. The `<name>.mod` file alongside the mod
 * directory holds the same keys plus `path`. This file reads `descriptor.mod`, the copy inside the
 * mod folder. `isValidModId` keeps the "non-empty string" contract that the parser enforces.
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

/** Parse one `key="value"` pair from a `descriptor.mod` line. Returns null on a mismatch. */
function parseKeyValue(line: string): { key: string; value: string } | null {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/.exec(line);
  if (!m) return null;
  return { key: m[1], value: m[2] };
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
  let name = "";
  let version = "";
  let supportedVersion = "";
  try {
    const text = readFileSync(descriptorPath, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const kv = parseKeyValue(line);
      if (!kv) continue;
      if (kv.key === "name") name = kv.value.trim();
      else if (kv.key === "version") version = kv.value.trim();
      else if (kv.key === "supported_version") supportedVersion = kv.value.trim();
    }
  } catch {
    return null;
  }
  if (!isValidModId(name)) return null;
  return { name, version, supportedVersion };
}
