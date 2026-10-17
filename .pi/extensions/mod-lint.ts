import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseDescriptorMod } from "../lib/mod-identity";

/**
 * validate_mod - the CK3 mod validation tool for the pdx-script mod type.
 * It was ported from lint_mod.py in eu5-starry-night-project, and it checks syntax and convention
 * rules only (there is no name-level semantic layer in v1):
 *   - descriptor.mod: presence, a key=value shape, a non-empty name, and a semver version.
 *   - Localization YAML: the UTF-8 BOM, the encoding, the `_l_<lang>` filename, the `l_<lang>:`
 *     header, the key line format, the double-quoted value, the quote balance, duplicate keys, and
 *     a mojibake warning.
 *   - PDXScript and GUI files: the .txt, .gui, .gfx, and .asset files under the mod root. The tool
 *     checks the UTF-8 encoding, the `{` and `}` balance, and the `"` balance, with awareness of
 *     `#` comments and multiline strings. There is no INJECT:/REPLACE: keyword system in CK3, so no
 *     keyword check exists.
 *
 * The tool is read-only, and it has no third-party dependency. Its content output uses PASS or FAIL with NEXT,
 * in ASCII English, and its details hold only ok, errors, and warnings.
 */

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const PDX_SUFFIXES = new Set([".txt", ".gui", ".gfx", ".asset"]);
const IMAGE_EXTS = new Set([".png", ".dds", ".jpg", ".jpeg", ".tga"]);
// A wildcard supported_version names no concrete game version, so it is too loose. This table is
// the single place to add a form. A value that names a concrete minor release ("1.20.*", or the
// two-level form "1.0.*") stays silent, because it still tells the player which release works.
const LOOSE_GAME_VERSION_RES = [
  /^\d+\.\*$/, // "1.*"   - wildcard patch level
  /^\d+\.\*\.\*$/, // "1.*.*" - wildcard minor and patch level
  /^\*$/, // "*"     - any game version
  /^\d+\.[xX]$/, // "1.x"   - wildcard patch level, spelled with x
];
const PUA_RE = /[\ue000-\uf8ff]/;
const LOC_KEY_RE = /^[ \t]*(?<key>[^\s:#][^:]*):(?<ver>\d*)\s*(?<rest>.*?)\s*$/;
const LOC_HEADER_RE = /^\ufeff?\s*l_(?<lang>[a-z_]+):(?<tail>.*)$/;

type Severity = "error" | "warn";
interface Finding {
  severity: Severity;
  rel: string;
  message: string;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Lists every file under modDir, and skips .git. Returns { absPath, relPosix }. */
function walkFiles(root: string): Array<{ abs: string; rel: string }> {
  const out: Array<{ abs: string; rel: string }> = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".git") continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push({ abs, rel: toPosix(relative(root, abs)) });
    }
  };
  walk(root);
  return out;
}

function isLocalizationYml(rel: string): boolean {
  const r = rel.toLowerCase();
  // walkFiles gives a path relative to the mod root, so CK3's own layout has no leading segment:
  // `localization/english/x_l_english.yml`. Accept a nested one too, for an old-style tree.
  return r.endsWith(".yml") && (r.startsWith("localization/") || r.includes("/localization/"));
}

// The languages CK3 ships. A localization file names its language with the `_l_<lang>` filename
// suffix (wiki Modding/Localization: "the filename must end with `_l_<language>`; any file name can
// be used as long as this format is respected"). The engine and DLC trees group files as
// `localization/<group>/<file>_l_<lang>.yml`, so the first directory is often a group and not a
// language. This set is the single place to add a language.
const LOC_LANGUAGES = new Set([
  "english",
  "french",
  "german",
  "japanese",
  "korean",
  "polish",
  "russian",
  "simp_chinese",
  "spanish",
]);

/** The known language named by the `_l_<lang>.yml` filename suffix, or null. */
function filenameLanguage(rel: string): string | null {
  const name = rel.split("/").pop() ?? rel;
  const stem = name.endsWith(".yml") ? name.slice(0, -4) : name;
  const lang = /_l_([a-z_]+)$/.exec(stem)?.[1];
  return lang !== undefined && LOC_LANGUAGES.has(lang) ? lang : null;
}

/**
 * The language token in the `_l_<lang>.yml` filename suffix, whether or not this game ships it. It
 * lets the error name the real cause when the language is valid but unsupported: the file is named
 * correctly, and renaming it cannot help.
 */
function declaredFilenameLanguage(rel: string): string | null {
  const name = rel.split("/").pop() ?? rel;
  const stem = name.endsWith(".yml") ? name.slice(0, -4) : name;
  return /_l_([a-z_]+)$/.exec(stem)?.[1] ?? null;
}

/**
 * The known language named by the localization directory, or null when the directory is a group.
 * The `replace/` level is skipped, because `localization/replace/<lang>/` overrides the vanilla keys
 * of <lang>.
 */
function directoryLanguage(rel: string): string | null {
  const parts = rel.split("/");
  const lowered = parts.map((p) => p.toLowerCase());
  const idx = lowered.indexOf("localization");
  if (idx < 0) return null;
  const tail = lowered.slice(idx + 1, -1);
  if (tail.length === 0) return null;
  const dir = tail[0] === "replace" && tail.length >= 2 ? tail[1] : tail[0];
  return LOC_LANGUAGES.has(dir) ? dir : null;
}

/**
 * The language that a localization file must declare. The directory is only a hint: the engine and
 * DLC trees group files as `localization/<group>/<file>_l_<lang>.yml`, where the first directory is
 * a group and not a language, so a directory that does not name a known language is ignored and the
 * `_l_<lang>` filename suffix decides. Returns null when neither names a known language, which
 * means the filename does not end with `_l_<language>.yml`.
 */
function expectedLanguageFromPath(rel: string): string | null {
  return directoryLanguage(rel) ?? filenameLanguage(rel);
}

function decodeUtf8(raw: Buffer): { text: string | null; err?: string } {
  try {
    // Strict UTF-8 decoding. The BOM is handled separately.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return { text };
  } catch {
    return { text: null, err: "not valid UTF-8" };
  }
}

function simpChineseMojibakeHint(text: string): boolean {
  if (text.includes("\u20ac")) return true; // euro sign
  let hits = 0;
  for (const ch of text) {
    const o = ch.codePointAt(0) ?? 0;
    if (o >= 0x20000 && o <= 0x323af) {
      hits += 1;
      if (hits >= 3) return true;
    }
  }
  return false;
}

/**
 * Checks the quote structure of a localization value. The value starts with `"` and ends at an
 * unescaped `"` that has only whitespace or a `#` comment after it. The tool accepts the last such
 * quote, so an inner quote and a doubled `""` are both legal: vanilla writes
 * `""L'État, c'est moi!""` and `"Enables a "bloom" effect."`. The check fails only when no
 * unescaped quote closes the value, for example `"unterminated` or `"a" trailing text`.
 */
function localizationValueQuoteOk(rest: string): boolean {
  let closed = false;
  for (let i = 1; i < rest.length; i += 1) {
    // Skip the opening quote. The caller guarantees that rest starts with one.
    if (rest[i] !== '"') continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && rest[j] === "\\"; j -= 1) backslashes += 1;
    if (backslashes % 2 === 1) continue; // An escaped quote is text, not a delimiter.
    const tail = rest.slice(i + 1).trim();
    if (tail === "" || tail.startsWith("#")) closed = true; // This quote closes the value.
  }
  return closed; // false when no closing quote was found, so the string is unterminated.
}

// ---- localization YAML ----

function checkLocalization(modRoot: string): Finding[] {
  const findings: Finding[] = [];
  for (const { abs, rel } of walkFiles(modRoot)) {
    if (!isLocalizationYml(rel)) continue;
    let raw: Buffer;
    try {
      raw = readFileSync(abs);
    } catch {
      findings.push({ severity: "error", rel, message: "cannot read file" });
      continue;
    }
    if (!raw.subarray(0, 3).equals(UTF8_BOM)) {
      findings.push({
        severity: "error",
        rel,
        message:
          "missing UTF-8 BOM (game ignores localization files without a BOM)",
      });
    }
    const { text, err } = decodeUtf8(raw);
    if (text === null) {
      findings.push({
        severity: "error",
        rel,
        message: err ?? "not valid UTF-8",
      });
      continue;
    }
    if (text.includes("\ufffd"))
      findings.push({
        severity: "warn",
        rel,
        message: "contains U+FFFD replacement character (file may be damaged)",
      });
    if (PUA_RE.test(text))
      findings.push({
        severity: "warn",
        rel,
        message: "contains Unicode private-use character(s) U+E000-U+F8FF",
      });
    const relLower = rel.toLowerCase();
    if (
      (relLower.includes("/simp_chinese/") ||
        relLower.includes("_simp_chinese")) &&
      simpChineseMojibakeHint(text)
    ) {
      findings.push({
        severity: "warn",
        rel,
        message:
          "possible simplified-Chinese mojibake (euro sign or rare extended ideographs). Check it in the game.",
      });
    }

    const expectedLang = expectedLanguageFromPath(rel);
    const name = rel.split("/").pop() ?? rel;
    const stem = name.endsWith(".yml") ? name.slice(0, -4) : name;
    if (expectedLang === null) {
      // Distinguish a missing or misspelled suffix from a valid language that this game does not
      // ship. Only the filename is used: `_l_<lang>` is always a language token, while the first
      // directory is often a group, not a language. The second case is not the agent's error, and
      // renaming the file cannot fix it.
      const declared = declaredFilenameLanguage(rel);
      findings.push({
        severity: "error",
        rel,
        message:
          declared !== null && !LOC_LANGUAGES.has(declared)
            ? `unsupported localization language '${declared}'; accepted: ${[...LOC_LANGUAGES].join(", ")}`
            : "filename must end with '_l_<language>.yml'",
      });
    } else if (!stem.endsWith(`_l_${expectedLang}`)) {
      findings.push({
        severity: "error",
        rel,
        message: `filename must end with '_l_${expectedLang}.yml' to match the '${expectedLang}' localization directory`,
      });
    }

    const lines = text.split(/\r?\n/);
    let headerSeen = false;
    const seenKeys = new Map<string, number>();
    for (let i = 0; i < lines.length; i += 1) {
      const lineNo = i + 1;
      const line = lines[i];
      const stripped = line.trim();
      if (stripped === "" || stripped.startsWith("#")) continue;
      const headerMatch = LOC_HEADER_RE.exec(line);
      if (!headerSeen) {
        if (!headerMatch) {
          findings.push({
            severity: "error",
            rel,
            message: `line ${lineNo}: expected a language header 'l_<lang>:' as the first content line`,
          });
          headerSeen = true;
        } else {
          headerSeen = true;
          const lang = headerMatch.groups?.lang;
          if (expectedLang && lang !== expectedLang) {
            findings.push({
              severity: "error",
              rel,
              message: `line ${lineNo}: header 'l_${lang}:' does not match the expected language '${expectedLang}'`,
            });
          }
          continue;
        }
      }
      if (headerMatch) continue; // A later language header line is allowed here.
      const m = LOC_KEY_RE.exec(line);
      if (!m) {
        findings.push({
          severity: "error",
          rel,
          message: `line ${lineNo}: malformed localization line (expected '  key: \"value\"' or '  key:0 \"value\"')`,
        });
        continue;
      }
      const rest = m.groups?.rest ?? "";
      if (!rest.startsWith('"')) {
        findings.push({
          severity: "error",
          rel,
          message: `line ${lineNo}: value must be double-quoted`,
        });
      } else if (!localizationValueQuoteOk(rest)) {
        findings.push({
          severity: "error",
          rel,
          message: `line ${lineNo}: unbalanced '\"' in value`,
        });
      }
      const key = (m.groups?.key ?? "").trim();
      if (seenKeys.has(key)) {
        findings.push({
          severity: "error",
          rel,
          message: `line ${lineNo}: duplicate key '${key}' (first seen line ${seenKeys.get(key)})`,
        });
      } else {
        seenKeys.set(key, lineNo);
      }
    }
  }
  return findings;
}

// ---- descriptor.mod ----

/** The image files directly in the mod root, as base names. Empty when there are none. */
function rootImages(modRoot: string): string[] {
  try {
    return readdirSync(modRoot)
      .filter((name) => {
        const dot = name.lastIndexOf(".");
        return (
          dot >= 0 &&
          IMAGE_EXTS.has(name.slice(dot).toLowerCase()) &&
          statSync(join(modRoot, name), { throwIfNoEntry: false })?.isFile() === true
        );
      })
      .sort();
  } catch {
    return [];
  }
}

function checkMetadata(modRoot: string): Finding[] {
  const findings: Finding[] = [];
  const meta = join(modRoot, "descriptor.mod");
  const rel = "descriptor.mod";
  if (!existsSync(meta)) {
    findings.push({
      severity: "error",
      rel,
      message: "missing descriptor.mod",
    });
    return findings;
  }
  let raw: Buffer;
  try {
    raw = readFileSync(meta);
  } catch {
    findings.push({
      severity: "error",
      rel,
      message: "cannot read descriptor.mod",
    });
    return findings;
  }
  const { text, err } = decodeUtf8(raw);
  if (text === null) {
    findings.push({
      severity: "error",
      rel,
      message: err ?? "cannot decode descriptor.mod",
    });
    return findings;
  }
  // The only braces in a descriptor are the `tags={ ... }` list, so a brace balance check catches a
  // malformed list such as `tags={ "Gameplay"` (missing the closing brace).
  const bal = checkBraceQuoteBalance(stripLineComments(text));
  if (!bal.ok && bal.message)
    findings.push({ severity: "error", rel, message: bal.message });

  const { scalars, tagsMalformed } = parseDescriptorMod(text);

  // The name is the directory name by convention, but the engine only requires a non-empty value.
  const name = scalars.get("name");
  if (name === undefined || name.trim() === "") {
    findings.push({
      severity: "error",
      rel,
      message: "name must be a non-empty string",
    });
  }

  // version is required. The game only requires a non-empty string: workshop mods use values like
  // "1" as well as "1.0.0", so no semver rule is enforced here.
  const version = scalars.get("version");
  if (version === undefined || version.trim() === "") {
    findings.push({
      severity: "error",
      rel,
      message: "version is required (a non-empty string)",
    });
  }

  // supported_version is recommended, not required. A wildcard that matches every release tells the
  // player nothing about the supported game version, so warn. A concrete value ("1.20.1") and a
  // concrete-minor wildcard ("1.20.*") stay silent.
  const supportedVersion = scalars.get("supported_version");
  if (supportedVersion === undefined) {
    findings.push({
      severity: "warn",
      rel,
      message: "missing 'supported_version' (the value is for example \"1.20.*\")",
    });
  } else if (LOOSE_GAME_VERSION_RES.some((re) => re.test(supportedVersion))) {
    findings.push({
      severity: "warn",
      rel,
      message: `supported_version '${supportedVersion}' is too loose. Write a patch-level wildcard such as 1.20.*, not '1.*' or '*'.`,
    });
  }

  // tags is optional. When it is present it must be a list of quoted strings; the multiline form
  // `tags={\n "Gameplay"\n "Balance"\n}` is valid and common in real workshop mods.
  if (tagsMalformed) {
    findings.push({
      severity: "error",
      rel,
      message:
        'tags must be a list of quoted strings that closes, for example tags={ "Gameplay" "Balance" }',
    });
  }

  // picture is optional. Warn only when the mod does have an image in the root but the key is
  // absent, which is the forgetful case; a mod with no image at all stays silent.
  const picture = scalars.get("picture");
  if (!picture) {
    const images = rootImages(modRoot);
    if (images.length > 0) {
      findings.push({
        severity: "warn",
        rel,
        message: `missing 'picture' entry, but the mod root has image file(s) ${images.join(", ")}. The launcher shows a default image until you name one, for example picture="thumbnail.png".`,
      });
    }
  } else if (
    !existsSync(join(modRoot, picture)) ||
    !statSync(join(modRoot, picture), { throwIfNoEntry: false })?.isFile()
  ) {
    const versioned = rootImages(modRoot);
    findings.push({
      severity: "warn",
      rel,
      message:
        versioned.length > 0
          ? `picture '${picture}' not found, but other image files exist in the mod root (possible filename mismatch)`
          : `picture '${picture}' not found, and the mod has no image file (the value must name an existing file in the mod root)`,
    });
  }
  return findings;
}

// ---- PDXScript and GUI brace and quote balance ----

/** Deletes a `#` line comment that is outside a quoted string. It keeps the line breaks, so line numbers still match. A string can span lines. */
function stripLineComments(text: string): string {
  const outLines: string[] = [];
  let inString = false;
  for (const raw of text.split("\n")) {
    let buf = "";
    for (const ch of raw) {
      if (inString) {
        buf += ch;
        if (ch === '"') inString = false;
      } else if (ch === "#") {
        break; // A line comment. Ignore the rest of this line.
      } else {
        buf += ch;
        if (ch === '"') inString = true;
      }
    }
    outLines.push(buf);
  }
  return outLines.join("\n");
}

interface BalanceResult {
  ok: boolean;
  message?: string;
}

function checkBraceQuoteBalance(cleaned: string): BalanceResult {
  let depth = 0;
  let inString = false;
  let stringStartLine = 0;
  let line = 1;
  for (const ch of cleaned) {
    if (ch === "\n") {
      line += 1;
      continue;
    }
    if (inString) {
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      stringStartLine = line;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth < 0)
        return {
          ok: false,
          message: `line ${line}: unexpected '}' (more closing than opening braces)`,
        };
    }
  }
  if (inString)
    return {
      ok: false,
      message: `line ${stringStartLine}: unbalanced '\"' (unterminated string)`,
    };
  if (depth > 0)
    return {
      ok: false,
      message: `unbalanced braces: ${depth} '{' never closed`,
    };
  return { ok: true };
}

function checkPdxScript(modRoot: string): Finding[] {
  const findings: Finding[] = [];
  for (const { abs, rel } of walkFiles(modRoot)) {
    const dot = rel.lastIndexOf(".");
    if (dot < 0 || !PDX_SUFFIXES.has(rel.slice(dot).toLowerCase())) continue;
    let raw: Buffer;
    try {
      raw = readFileSync(abs);
    } catch {
      findings.push({ severity: "error", rel, message: "cannot read file" });
      continue;
    }
    const { text, err } = decodeUtf8(raw);
    if (text === null) {
      findings.push({
        severity: "error",
        rel,
        message: err ?? "not valid UTF-8",
      });
      continue;
    }
    const cleaned = stripLineComments(text);
    const bal = checkBraceQuoteBalance(cleaned);
    if (!bal.ok && bal.message)
      findings.push({ severity: "error", rel, message: bal.message });
  }
  return findings;
}

const MAX_CONTENT_LINES = 200;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "validate_mod",
    label: "Validate Mod",
    description:
      "Validate a CK3 mod of the pdx-script type, under your_mods/. It checks the descriptor.mod fields (name, version, supported_version, picture), the localization YAML, and the brace and quote balance in PDXScript and GUI files. It does not check effect, trigger, or modifier names, scope, type, or values.",
    promptSnippet: "Validate a mod under your_mods/",
    promptGuidelines: [
      "Use validate_mod after you write a mod, to check that it passes the rules.",
      "Fix every validate_mod ERROR before you call a mod done. WARNs are advisory.",
    ],
    parameters: Type.Object({
      modDir: Type.String({
        description: "Path to the mod directory, for example your_mods/<ModName>",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Resolve a relative path against the workspace, which is ctx.cwd. The agent passes
      // your_mods/<name>, and the process cwd is not reliable. install_mod and sync_game_scripts
      // do the same.
      const modDir = params.modDir ? resolve(ctx.cwd, params.modDir) : "";
      if (
        !params.modDir ||
        typeof params.modDir !== "string" ||
        !statSync(modDir, { throwIfNoEntry: false })?.isDirectory()
      ) {
        throw new Error(
          `INVALID_MOD_DIR: ${params.modDir ?? "(not given)"} is not a directory`,
        );
      }

      const findings = [
        ...checkMetadata(modDir),
        ...checkLocalization(modDir),
        ...checkPdxScript(modDir),
      ];
      const errors = findings.filter((f) => f.severity === "error");
      const warnings = findings.filter((f) => f.severity === "warn");

      const name = modDir.split(/[\\/]/).pop() || modDir;
      const lines: string[] = [];
      if (errors.length === 0) {
        lines.push(
          `PASS: ${name} is valid - syntax and conventions only. Effect, trigger, and modifier names, scope, type, and values are not checked.${warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""}`,
        );
        for (const w of warnings.slice(0, MAX_CONTENT_LINES)) {
          lines.push(`WARN: ${w.rel}: ${w.message}`);
        }
      } else {
        lines.push(
          `FAIL: ${name} has ${errors.length} error(s), ${warnings.length} warning(s)`,
        );
        for (const e of errors.slice(0, MAX_CONTENT_LINES)) {
          lines.push(`ERROR: ${e.rel}: ${e.message}`);
        }
        if (errors.length > MAX_CONTENT_LINES) {
          lines.push(
            `... ${errors.length - MAX_CONTENT_LINES} more error(s) omitted`,
          );
        }
        lines.push(`NEXT: fix the errors above and re-run validate_mod.`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          ok: errors.length === 0,
          errors: errors.map((e) => `${e.rel}: ${e.message}`),
          warnings: warnings.map((w) => `${w.rel}: ${w.message}`),
        },
      };
    },
  });
}
