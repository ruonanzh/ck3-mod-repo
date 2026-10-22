#!/usr/bin/env node
/**
 * Refresh docs/wiki/ from the CK3 wiki mirror.
 *
 * Source: https://github.com/jesec/ck3-modding-wiki (`wiki_pages/<Page>.md`), an automated mirror of
 * ck3.paradoxwikis.com. The live wiki sits behind a JavaScript challenge, so this copy is the
 * practical source. The content is CC BY-SA 3.0; `docs/wiki/LICENSE` carries the notice.
 *
 * What this script changes in each page, so the copy fits this repository:
 *   - Drops image references (`../assets/...`). The icons are 8 MB and the text is what we need.
 *   - Rewrites a link to a page we do not ship into the absolute wiki URL, so
 *     `scripts/check-doc-refs.mjs` stays green and a reader can still reach it.
 *   - Adds a two-line provenance header under the title.
 *
 * It also checks `docs/wiki/INDEX.md`, one row per wiki page: title, whether it is shipped, and a
 * one-line description. That file is written by hand, so the check only reports drift.
 *
 * Usage: node scripts/sync-wiki.mjs [--check]
 *   (no flag)  fetch and write docs/wiki/
 *   --check    fetch and report what would change; exit 1 when a page or an INDEX row differs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "wiki");
const REPO = "jesec/ck3-modding-wiki";
const RAW = `https://raw.githubusercontent.com/${REPO}/master`;

/**
 * The pages this repository ships. Two groups, and both are needed.
 *
 * 1. Reference: the exact name, parameters, and scope of an effect, trigger, modifier, or scope, and
 *    the language rules behind them. The vanilla scripts show usage; these show the form.
 * 2. How-to coverage: one page per thing a player can ask "how do I add X" about. A player question
 *    arrives without warning, and a subagent cannot fetch, so the answer must already be here.
 *    Buildings, for example, have no page of their own; `Holdings_modding.md` carries them.
 *    Deliberately left out, and fetched on demand: the graphics pipeline (Map, Terrain,
 *    Coat of arms, 3D models, Sound, Music, Fonts), the console and data tables, and Data_types,
 *    which `dump_data_types` regenerates version-exact.
 */
const PAGES = [
  // Reference
  "Scripting.md", // syntax, scopes, operators, variables, iterators, templates
  "Effects_list.md", // every code effect: parameters and scopes
  "Triggers_list.md", // every trigger: parameters and scopes
  "Modifier_list.md", // every modifier and the scope family it belongs to
  "Scopes.md", // scope rules and transitions
  "Scopes_list.md", // every scope
  "Variables.md", // variable syntax and lifetime
  "Script_values.md", // script values and math
  "Weight_modifier.md", // weight blocks for random lists
  "Scripted_effects.md", // reusable effect blocks
  // How-to coverage: one page per "how do I add X"
  "Event_modding.md", // events, options, portraits
  "Decisions_modding.md", // decisions
  "Interactions_modding.md", // character interactions
  "Holdings_modding.md", // holdings and buildings
  "Trait_modding.md", // traits
  "Culture_modding.md", // cultures and traditions
  "Religions_modding.md", // faiths, doctrines, holy orders
  "Governments_modding.md", // government types
  "Title_modding.md", // titles and succession
  "Dynasties_modding.md", // dynasties and houses
  "Characters_modding.md", // characters and their attributes
  "Lifestyles_modding.md", // lifestyles and perks
  "AI_modding.md", // AI personality, weights, and defines
  "Resources_modding.md", // resources
  "Artifact_modding.md", // artifacts and relics
  "Regiments_modding.md", // men-at-arms and units
  "Council_modding.md", // council positions and tasks
  "Struggle_modding.md", // regional struggles
  "Story_cycles_modding.md", // story cycles
  "History_modding.md", // historical setup and start dates
  "Bookmarks_modding.md", // bookmarks and start dates
  "Interface.md", // the GUI system, needed for any .gui override
  // Localization features and operations
  "Flavorization.md", // dynamic text and name generation
  "Customizable_localization.md", // customizable localization blocks
  "Mod_compatibility.md", // load order and conflicts
  "Mod_troubleshooting.md", // error.log and common failures
];

/** Overrides for a mirror README line that loses a word the agent needs to find this page. */
const DESCRIPTION_OVERRIDES = {
  "Holdings_modding.md": "Baronies, holdings, and buildings (there is no separate building page)",
};

/** The snapshot README leaves these pages out; describe them so every index row has an answer. */
const FALLBACK_DESCRIPTIONS = {
  "AI_modding.md": "AI personality, weights, and defines",
  "Customizable_localization.md": "Customizable localization blocks",
  "Lifestyles_modding.md": "Lifestyles and perks",
  "List_of_baronies.md": "Every barony in the game",
  "Mod_compatibility.md": "Load order and mod conflicts",
  "Resources_modding.md": "Resources",
  "Script_values.md": "Script values and their math",
};

const SHIPPED = new Set(PAGES);
const imageRe = /!\[[^\]]*\]\(\.\.\/assets\/[^)]*\)/g;

/** `<Page>.md` → keep when shipped, else the absolute wiki URL. Anchors are preserved. */
function rewriteLinks(text) {
  return text.replace(/\]\(([A-Za-z0-9_]+\.md)(#[^)]*)?\)/g, (whole, page, anchor) => {
    if (SHIPPED.has(page)) return whole;
    const title = page.replace(/\.md$/, "");
    return `](https://ck3.paradoxwikis.com/${title}${anchor ?? ""})`;
  });
}

/** Puts the provenance line directly under the first H1. */
function addHeader(text, page) {
  const note =
    `> Snapshot of [\`${REPO}\`](https://github.com/${REPO}) \`wiki_pages/${page}\`, ` +
    `which mirrors [ck3.paradoxwikis.com](https://ck3.paradoxwikis.com). ` +
    `Licensed CC BY-SA 3.0 (see \`LICENSE\`). Refresh with \`node scripts/sync-wiki.mjs\`.`;
  const lines = text.split("\n");
  const h1 = lines.findIndex((line) => line.startsWith("# "));
  if (h1 < 0) return `${note}\n\n${text}`;
  lines.splice(h1 + 1, 0, "", note);
  return lines.join("\n");
}

/** Fetches a repository file. GitHub raw is intermittently reset here, so bound and retry. */
async function fetchRaw(path) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${RAW}/${path}`, {
        headers: { "user-agent": "ck3-mod-repo-wiki-sync" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      last = error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`${path}: ${last instanceof Error ? last.message : String(last)}`);
}

/** Compares without regard to the line ending the checkout used. */
const normalizeEol = (text) => text.replaceAll("\r\n", "\n");

/** Writes one file when its content changed. Returns true when it wrote. */
function writeIfChanged(target, content, label, check) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current !== null && normalizeEol(current) === normalizeEol(content)) return false;
  if (check) {
    console.log(`  DIFF: ${label}`);
    return true;
  }
  writeFileSync(target, content);
  console.log(`  wrote ${label}`);
  return true;
}

/**
 * docs/wiki/INDEX.md: every wiki page, one row. It replaces the snapshot's TABLE_OF_CONTENTS, whose
 * 659 section links are a map of the wiki; each page already carries its own section list, and an
 * agent should not read 659 lines to learn whether a page exists.
 */
async function checkIndex() {
  const toc = await fetchRaw("TABLE_OF_CONTENTS.md");
  const readme = await fetchRaw("README.md");
  const titles = new Map();
  for (const m of toc.matchAll(/^## \[([^\]]+)\]\(wiki_pages\/([A-Za-z0-9_]+\.md)\)/gm)) {
    titles.set(m[2], m[1]);
  }
  const descriptions = new Map();
  for (const m of readme.matchAll(/^- \[[^\]]+\]\(wiki_pages\/([A-Za-z0-9_]+\.md)\) - (.+)$/gm)) {
    descriptions.set(m[1], m[2].trim());
  }
  const rows = [...titles.entries()]
    .map(([page, title]) => ({
      page,
      title,
      description: DESCRIPTION_OVERRIDES[page] ?? descriptions.get(page) ?? FALLBACK_DESCRIPTIONS[page] ?? "",
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "en"))
    .map(({ page, title, description }) => {
      const local = SHIPPED.has(page);
      const link = local
        ? `[${title}](./${page})`
        : `[${title}](https://ck3.paradoxwikis.com/${page.replace(/\.md$/, "")})`;
      return `| ${link} | ${local ? "yes" : "no"} | ${description} |`;
    });
  const expected = rows.map((row) => row.trim()).join("\n");
  const file = join(outDir, "INDEX.md");
  const rowsOf = (text) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("| ["))
      .join("\n");
  const current = existsSync(file) ? normalizeEol(readFileSync(file, "utf8")) : "";
  if (rowsOf(current) === expected) return false;
  console.error("  FAIL: docs/wiki/INDEX.md rows are out of date. Update them by hand from the list below.");
  console.error(expected);
  return true;
}


/**
 * docs/wiki/README.md is generated from `scripts/wiki-readme.md`: the template holds the prose and the
 * page rows, and this file fills the three counts and checks that the rows still match PAGES. The
 * template is not shipped, so the snapshot keeps one hand-written file, INDEX.md.
 */
function writeReadme(check) {
  const template = readFileSync(join(root, "scripts", "wiki-readme.md"), "utf8");
  const listed = new Set();
  const excluded = new Set();
  let inExcluded = false;
  for (const line of template.split("\n")) {
    if (line.startsWith("Excluded on purpose")) inExcluded = true;
    if (line.startsWith("## ")) inExcluded = false;
    if (!line.startsWith("| `")) continue;
    if (inExcluded) {
      for (const match of line.matchAll(/`([A-Za-z0-9_]+)`/g)) excluded.add(match[1]);
    } else {
      for (const match of line.matchAll(/`([A-Za-z0-9_]+)\.md`/g)) listed.add(`${match[1]}.md`);
    }
  }
  const shipped = new Set(PAGES);
  const missing = PAGES.filter((page) => !listed.has(page));
  if (missing.length > 0) throw new Error(`the template does not list ${missing.join(", ")}`);
  const all = listed.size + excluded.size;
  const body = template
    .replaceAll("{{ALL}}", String(all))
    .replaceAll("{{LOCAL}}", String(PAGES.length))
    .replaceAll("{{EXTERNAL}}", String(excluded.size));
  return writeIfChanged(join(outDir, "README.md"), body, "docs/wiki/README.md", check);
}
async function main() {
  const check = process.argv.includes("--check");
  if (!check) mkdirSync(outDir, { recursive: true });
  let written = 0;
  let drifted = 0;
  for (const page of PAGES) {
    let text;
    try {
      text = await fetchRaw(`wiki_pages/${page}`);
    } catch (error) {
      console.error(`  FAIL: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      continue;
    }
    const body = addHeader(rewriteLinks(text.replace(imageRe, "")).replace(/\n{3,}/g, "\n\n"), page);
    if (writeIfChanged(join(outDir, page), body, `docs/wiki/${page}`, check)) {
      if (check) drifted += 1;
      else written += 1;
    }
  }
  try {
    if (await checkIndex()) drifted += 1;
  } catch (error) {
    console.error(`  FAIL: docs/wiki/INDEX.md: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  try {
    if (writeReadme(check)) {
      if (check) drifted += 1;
      else written += 1;
    }
  } catch (error) {
    console.error(`  FAIL: docs/wiki/README.md: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  if (process.exitCode === 1) {
    console.log("  skip: the snapshot could not be fully fetched, so there is no ok line");
    return;
  }
  if (check) {
    if (drifted > 0) process.exit(1);
    console.log(`  ok: ${PAGES.length + 1} file(s) match the snapshot`);
    return;
  }
  console.log(`  done: ${written} file(s) written, ${PAGES.length + 1 - written} unchanged`);
}

await main();
