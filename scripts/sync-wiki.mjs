#!/usr/bin/env node
/**
 * Refresh docs/wiki/ from the CK3 wiki mirror.
 *
 * Source: https://github.com/jesec/ck3-modding-wiki (`wiki_pages/<Page>.md`), an automated mirror of
 * ck3.paradoxwikis.com. The live wiki sits behind a JavaScript challenge, so the mirror is the
 * practical source. The content is CC BY-SA 3.0; `docs/wiki/LICENSE` carries the notice.
 *
 * What this script changes in each page, so the copy fits this repository:
 *   - Drops image references (`../assets/...`). The icons are 8 MB and the text is what we need.
 *   - Rewrites a link to a page we do not ship into the absolute wiki URL, so
 *     `scripts/check-doc-refs.mjs` stays green and a reader can still reach it.
 *   - Adds a two-line provenance header under the title.
 *
 * Usage: node scripts/sync-wiki.mjs [--check]
 *   (no flag)  fetch and write docs/wiki/
 *   --check    fetch and report what would change; exit 1 when a page differs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "wiki");
const REPO = "jesec/ck3-modding-wiki";
// The raw base for a page file is `${REPO_BASE}/wiki_pages/`; fetchRaw takes a repository-relative path.
const REPO_BASE = `https://raw.githubusercontent.com/${REPO}/master`;

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

async function fetchPage(page) {
  return fetchRaw(`wiki_pages/${page}`);
}

/** Fetches a repository file, with a bounded attempt and retries. */
async function fetchRaw(path) {
  // GitHub raw is intermittently reset on this network, and fetch has no default timeout, so a
  // failed connection can hang the whole sync. Bound each attempt and retry twice.
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`https://raw.githubusercontent.com/${REPO}/master/${path}`, {
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

async function main() {
  const check = process.argv.includes("--check");
  if (!check) mkdirSync(outDir, { recursive: true });
  let changed = 0;
  for (const page of PAGES) {
    let text;
    try {
      text = await fetchPage(page);
    } catch (error) {
      console.error(`  FAIL: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      continue;
    }
    const body = addHeader(rewriteLinks(text.replace(imageRe, "")).replace(/\n{3,}/g, "\n\n"), page);
    const target = join(outDir, page);
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current === body) continue;
    changed += 1;
    if (check) {
      console.log(`  DIFF: ${page}`);
    } else {
      writeFileSync(target, body);
      console.log(`  wrote docs/wiki/${page}`);
    }
  }
  if (check) {
    if (changed > 0) process.exit(1);
    console.log(`  ok: ${PAGES.length} page(s) match the mirror`);
    return;
  }
  console.log(`  done: ${changed} page(s) updated, ${PAGES.length - changed} unchanged`);

  // The mirror also ships a table of contents for every page, shipped or not. Keep it, so an agent
  // can see that a page exists before deciding to ask for it. Links to a page we do not ship point
  // at the wiki instead.
  try {
    const toc = await fetchRaw("TABLE_OF_CONTENTS.md");
    const body = `${toc
      .split(/\r?\n/)
      .map((line) => line.replace(/\]\(wiki_pages\/([A-Za-z0-9_]+\.md)(#[^)]*)?\)/g, (whole, page, anchor) =>
        SHIPPED.has(page)
          ? `](./${page}${anchor ?? ""})`
          : `](https://ck3.paradoxwikis.com/${page.replace(/\.md$/, "")}${anchor ?? ""})`,
      ))
      .join("\n")}\n`;
    const header =
      "> Index of **every** page in the wiki mirror (`jesec/ck3-modding-wiki`), including the pages this\n" +
      "> workspace does not ship. A relative link opens the local copy; a link to `ck3.paradoxwikis.com`\n" +
      "> is not shipped, and the reader must fetch it. What is shipped, and why, is in `README.md`.\n";
    const target = join(outDir, "TABLE_OF_CONTENTS.md");
    const content = `${body.replace(/^(# .+\n)/, `$1\n${header}`)}`;
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current !== content) {
      writeFileSync(target, content);
      console.log("  wrote docs/wiki/TABLE_OF_CONTENTS.md");
    }
  } catch (error) {
    console.error(`  FAIL: TABLE_OF_CONTENTS.md: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await main();
