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
const RAW = `https://raw.githubusercontent.com/${REPO}/master/wiki_pages`;

/**
 * The pages this repository ships. Every page here answers a question the mod scripts cannot:
 * the exact name, parameters and scope of an effect, trigger, modifier or scope, and the language
 * rules behind them. Feature guides that only restate what vanilla files show stay out.
 */
const PAGES = [
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
  "Event_modding.md", // the most common entry point: events, options, portraits
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
  const response = await fetch(`${RAW}/${page}`, {
    headers: { "user-agent": "ck3-mod-repo-wiki-sync" },
  });
  if (!response.ok) throw new Error(`${page}: HTTP ${response.status}`);
  return response.text();
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
}

await main();
