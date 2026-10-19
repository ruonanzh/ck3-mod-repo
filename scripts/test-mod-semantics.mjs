#!/usr/bin/env node
/**
 * test-mod-semantics - the case matrix for `.pi/lib/mod-semantics.ts`.
 *
 * It builds a small vanilla mirror and a set of mod fixtures in a temporary directory, then calls
 * `analyzeSemantics` on each fixture. It needs no CK3 install: the name check reads the committed
 * dumps under `docs/script_docs/`, and the modding context is generated here.
 *
 * The harness copies the two library files to the temporary directory and adds the `.ts` extension
 * to their relative imports, so the run uses the repository source and no third-party loader.
 * Node 22.18 or later runs TypeScript directly (type stripping).
 *
 * Usage: node scripts/test-mod-semantics.mjs [--keep]
 *   --keep  keep the temporary directory and print its path
 *
 * The cases marked `known` are defects recorded in `scripts/README.md`. A known case that starts
 * to pass is reported as FIXED, and the `known` flag can then be removed. Only an unexpected
 * mismatch makes the command exit with code 1.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = process.argv.includes("--keep");
for (const file of ["effects.log", "triggers.log", "modifiers.log"]) {
  const path = join(REPO, "docs", "script_docs", file);
  if (!existsSync(path)) {
    console.error(`FAIL: ${path} is missing. The dumps are committed, so restore them before you run this test.`);
    process.exit(1);
  }
}
const WORK = mkdtempSync(join(tmpdir(), "ck3-mod-semantics-"));

/** Write one file, and create its parent directories. */
function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Build a mod directory. `loc` lines are written after the `l_english:` header. */
function makeMod(root, name, files, loc = []) {
  const dir = join(root, "your_mods", name);
  write(
    join(dir, "descriptor.mod"),
    `version="1.0"\nname="${name}"\nsupported_version="1.20.*"\n`,
  );
  for (const [rel, text] of Object.entries(files)) write(join(dir, rel), text);
  if (loc.length > 0) {
    write(
      join(dir, "localization/english", `${name}_l_english.yml`),
      "\uFEFFl_english:\n" + loc.map((line) => ` ${line}\n`).join(""),
    );
  }
  return dir;
}

/** The twelve vanilla directories that the name check reads. */
const VANILLA_DIRS = [
  "traits",
  "decisions",
  "character_interactions",
  "scripted_effects",
  "scripted_triggers",
  "script_values",
  "on_action",
  "modifiers",
  "buildings",
  "activities",
  "schemes",
  "scripted_guis",
];

/**
 * Build one workspace root. `kind` selects a degradation case:
 *   full       a mirror and the committed dumps
 *   nomirror   no game-scripts/ directory, but the dumps exist
 *   nodumps    a mirror, but no docs/script_docs/
 *   emptydumps a mirror, and an empty effects.log and triggers.log
 *   partial    only game-scripts/vanilla/game/common/ exists
 *   partialone only common/traits/ exists, so one of the twelve directories is present
 *   partialdumps a mirror, and an empty effects.log (triggers.log and modifiers.log exist)
 */
let roots = 0;
function makeRoot(kind) {
  const root = join(WORK, `${kind}-${++roots}`);
  if (kind !== "nomirror" && kind !== "partial" && kind !== "partialone") {
    const v = join(root, "game-scripts", "vanilla", "game", "common");
    write(join(v, "traits", "00_traits.txt"), "brave = {\n\tdiplomacy = 2\n\trandom_traits = yes\n}\n");
    write(join(v, "decisions", "00_decisions.txt"), "vanilla_decision = {\n\tdesc = vanilla_decision_desc\n}\n");
    write(join(v, "character_interactions", "00_interactions.txt"), "vanilla_interaction = {\n\tdesc = vanilla_interaction\n}\n");
    write(join(v, "scripted_effects", "00_effects.txt"), "vanilla_effect = {\n\tadd_gold = 1\n}\n");
    for (const dir of VANILLA_DIRS) write(join(v, dir, "00_empty.txt"), "");
  }
  if (kind === "partial") mkdirSync(join(root, "game-scripts", "vanilla", "game", "common"), { recursive: true });
  if (kind === "partialone") {
    const v = join(root, "game-scripts", "vanilla", "game", "common");
    write(join(v, "traits", "00_traits.txt"), "brave = {\n\tdiplomacy = 2\n\trandom_traits = yes\n}\n");
  }

  if (kind !== "nodumps") {
    const d = join(root, "docs", "script_docs");
    mkdirSync(d, { recursive: true });
    if (kind === "emptydumps") {
      write(join(d, "effects.log"), "");
      write(join(d, "triggers.log"), "");
    } else if (kind === "partialdumps") {
      write(join(d, "effects.log"), "");
      for (const file of ["triggers.log", "modifiers.log"]) {
        copyFileSync(join(REPO, "docs", "script_docs", file), join(d, file));
      }
    } else {
      for (const file of ["effects.log", "triggers.log", "modifiers.log"]) {
        copyFileSync(join(REPO, "docs", "script_docs", file), join(d, file));
      }
    }
  }
  return root;
}

// Copy the two library files, and make their relative imports resolvable by Node.
const LIB = join(WORK, "lib");
mkdirSync(LIB, { recursive: true });
for (const file of ["mod-semantics.ts", "game-paths.ts"]) {
  const text = readFileSync(join(REPO, ".pi", "lib", file), "utf8").replace(
    /(from\s+["'])(\.\/[^"']+)(["'])/g,
    (_match, before, specifier, after) => `${before}${specifier.endsWith(".ts") ? specifier : `${specifier}.ts`}${after}`,
  );
  writeFileSync(join(LIB, file), text);
}
const { analyzeSemantics } = await import(pathToFileURL(join(LIB, "mod-semantics.ts")).href);

const full = makeRoot("full");
const nomirror = makeRoot("nomirror");
const nodumps = makeRoot("nodumps");
const emptydumps = makeRoot("emptydumps");
const partial = makeRoot("partial");
const partialone = makeRoot("partialone");
const partialdumps = makeRoot("partialdumps");

/** The expected finding: level, code, and an optional substring of the message. */
const finding = (level, code, contains) => ({ level, code, contains });

const cases = [];
const add = (name, root, modDir, expect, checkedLength, known = false) =>
  cases.push({ name, root, modDir, expect, checkedLength, known });

// The localization-key check.
add(
  "override-vanilla-trait",
  full,
  makeMod(full, "override", { "common/traits/o.txt": "brave = {\n\tdiplomacy = 3\n}\n" }),
  [],
  2,
);
add(
  "new-trait-full-loc",
  full,
  makeMod(
    full,
    "trait_ok",
    { "common/traits/n.txt": "new_trait_alpha = {\n\tdiplomacy = 1\n}\n" },
    ['trait_new_trait_alpha:0 "N"', 'trait_new_trait_alpha_desc:0 "D"'],
  ),
  [],
  2,
);
add(
  "new-trait-no-loc",
  full,
  makeMod(full, "trait_missing", { "common/traits/n.txt": "new_trait_beta = {\n\tdiplomacy = 1\n}\n" }),
  [finding("warn", "new-object-loc", 'has no localization key "trait_new_trait_beta" or "trait_new_trait_beta_desc"')],
  2,
);
add(
  "new-trait-name-only",
  full,
  makeMod(
    full,
    "trait_partial",
    { "common/traits/n.txt": "new_trait_gamma = {\n\tdiplomacy = 1\n}\n" },
    ['trait_new_trait_gamma:0 "N"'],
  ),
  [finding("warn", "new-object-loc", '"trait_new_trait_gamma_desc"')],
  2,
);
add(
  "decision-desc-field",
  full,
  makeMod(
    full,
    "decision_desc",
    { "common/decisions/d.txt": "dec_alpha = {\n\tdesc = { first_valid = { triggered_desc = { desc = dec_alpha } } }\n}\n" },
    ['dec_alpha:0 "D"'],
  ),
  [],
  2,
);
add(
  "decision-no-loc",
  full,
  makeMod(full, "decision_missing", { "common/decisions/d.txt": "dec_beta = {\n\tsort_order = 1\n}\n" }),
  [finding("warn", "new-object-loc", 'has no localization key "dec_beta" or "dec_beta_desc"')],
  2,
);
add(
  "decision-title-override",
  full,
  makeMod(
    full,
    "decision_title",
    { "common/decisions/d.txt": "my_shared_decision = {\n\ttitle = shared_title_key\n\tdesc = my_shared_decision_desc\n\teffect = { add_gold = 1 }\n}\n" },
    ['my_shared_decision_desc:0 "D"', 'shared_title_key:0 "T"'],
  ),
  [],
  2,
);
add(
  "character-interaction-ok",
  full,
  makeMod(
    full,
    "interaction_ok",
    { "common/character_interactions/i.txt": "int_alpha = {\n\tdesc = int_alpha\n}\n" },
    ['int_alpha:0 "I"'],
  ),
  [],
  2,
);
add(
  "character-interaction-no-loc",
  full,
  makeMod(full, "interaction_missing", { "common/character_interactions/i.txt": "int_beta = {\n\tsort_order = 1\n}\n" }),
  [finding("warn", "new-object-loc", '"int_beta"')],
  2,
);

// The near-miss check.
add(
  "near-miss-and-exemptions",
  full,
  makeMod(full, "names", {
    "common/scripted_effects/se.txt":
      "my_long_effect_def = {\n" +
      "\tadd_traitt = brave\n" +
      "\tadd_traiit = brave\n" +
      "\tadd_traiiit = brave\n" +
      "\ttotally_unrelated_name_zzz = brave\n" +
      "\trandom_traits = yes\n" +
      "\tsave_scope_as = my_long_saved_scope\n" +
      '\tdesc = "add_traitt in a string"\n' +
      "\t# add_traitt in a comment\n" +
      "}\n",
    "common/on_action/oa.txt": "my_long_on_action = {\n\tevents = { my_long_effect_def = 1 }\n}\n",
  }),
  [
    finding("warn", "near-miss-name", '"add_traitt"'),
    finding("warn", "near-miss-name", '"add_traiit"'),
    finding("warn", "near-miss-name", '"add_traiiit"'),
  ],
  2,
);
add(
  "cross-file-and-inline-definitions",
  full,
  makeMod(full, "cross_file", {
    "common/scripted_effects/a.txt":
      "cross_file_effect_xyz = {\n\tadd_gold = 1\n}\n" +
      "scripted_effect inline_effect_xyz = {\n\tadd_gold = 1\n}\n",
    "common/on_action/b.txt":
      "cross_file_on_action = {\n\tevents = {\n\t\tcross_file_effect_xyz = 1\n\t\tinline_effect_xyz = 1\n\t}\n}\n",
  }),
  [],
  2,
);
add(
  "short-names-are-not-compared",
  full,
  makeMod(full, "short_names", {
    "common/scripted_effects/a.txt": "foo_bar = {\n\tadd_gold = 1\n}\n",
  }),
  [],
  2,
);
add(
  "vanilla-field-is-known",
  full,
  makeMod(full, "vanilla_field", {
    "common/scripted_effects/a.txt": "my_long_effect_abc = {\n\trandom_traits = yes\n}\n",
  }),
  [],
  2,
);

// Known false negatives: the parser and the field matcher. See scripts/README.md.
add(
  "icon-nested-desc",
  full,
  makeMod(
    full,
    "icon_desc",
    {
      "common/traits/i.txt":
        'icon_trait_delta = {\n\ticon = {\n\t\tfirst_valid = {\n\t\t\ttriggered_desc = {\n' +
        '\t\t\t\ttrigger = { NOT = { exists = this } }\n' +
        '\t\t\t\tdesc = "gfx/interface/icons/traits/diligent.dds"\n' +
        '\t\t\t}\n\t\t}\n\t}\n}\n',
    },
    ['trait_icon_trait_delta:0 "N"'],
  ),
  [finding("warn", "new-object-loc", '"trait_icon_trait_delta_desc"')],
  2,
);
add(
  "indented-definition",
  full,
  makeMod(full, "indented", { "common/traits/i.txt": "    indented_trait_xyz = {\n        diplomacy = 1\n    }\n" }),
  [finding("warn", "new-object-loc", '"trait_indented_trait_xyz"')],
  2,
);
add(
  "bom-before-first-definition",
  full,
  makeMod(full, "bom", { "common/traits/b.txt": "\uFEFFbom_trait_xyz = {\n\tdiplomacy = 1\n}\n" }),
  [finding("warn", "new-object-loc", '"trait_bom_trait_xyz"')],
  2,
);

// Degradation: the modding context and the dumps are repository setup, not repository content.
const degradeMod = (root, name) =>
  makeMod(root, name, { "common/traits/n.txt": "new_trait_beta = {\n\tdiplomacy = 1\n}\n" });
add("missing-mirror", nomirror, degradeMod(nomirror, "d_missing"), [finding("note", "mirror-missing", "vanilla scripts are missing")], 0);
add("mirror-without-dumps", nodumps, degradeMod(nodumps, "d_nodumps"), [
  finding("warn", "new-object-loc", '"trait_new_trait_beta"'),
  finding("note", "dump-missing", "dumps are missing"),
], 1);
add("empty-dumps", emptydumps, degradeMod(emptydumps, "d_empty"), [
  finding("warn", "new-object-loc", '"trait_new_trait_beta"'),
  finding("note", "dump-missing", "dumps are missing"),
], 1);
add(
  "partial-mirror",
  partial,
  makeMod(partial, "d_partial", { "common/traits/o.txt": "brave = {\n\tdiplomacy = 3\n}\n" }),
  [finding("note", "mirror-incomplete", "has no data directory")],
  0,
);
add(
  "partial-mirror-one-dir",
  partialone,
  makeMod(partialone, "d_partialone", { "common/traits/o.txt": "brave = {\n\tdiplomacy = 3\n}\n" }),
  [finding("note", "mirror-partial", "modding context has no")],
  2,
);
add(
  "partial-dumps",
  partialdumps,
  makeMod(partialdumps, "d_partialdumps", { "common/scripted_effects/e.txt": "my_long_effect_abc = {\n}\n" }),
  [finding("note", "dump-partial", "effects.log")],
  2,
);

// Run the matrix.
let passed = 0;
let failed = 0;
let known = 0;
let fixed = 0;
for (const test of cases) {
  const result = analyzeSemantics(test.modDir, test.root);
  const got = result.findings;
  const sameCount = got.length === test.expect.length;
  const sameEach = test.expect.every((want) =>
    got.some(
      (actual) =>
        actual.level === want.level &&
        actual.code === want.code &&
        (want.contains === undefined || actual.message.includes(want.contains)),
    ),
  );
  const sameChecked = result.checked.length === test.checkedLength;
  const ok = sameCount && sameEach && sameChecked;

  if (ok && test.known) {
    fixed += 1;
    console.log(`FIXED       ${test.name} (remove the known flag)`);
  } else if (ok) {
    passed += 1;
    console.log(`PASS        ${test.name}`);
  } else if (test.known) {
    known += 1;
    console.log(`KNOWN       ${test.name}`);
    for (const finding of got) console.log(`              got ${finding.level}:${finding.code}: ${finding.message}`);
    if (!sameChecked) console.log(`              checked=${JSON.stringify(result.checked)}`);
  } else {
    failed += 1;
    console.log(`FAIL        ${test.name}`);
    if (!sameCount) console.log(`              expected ${test.expect.length} finding(s), got ${got.length}`);
    for (const finding of got) console.log(`              got ${finding.level}:${finding.code}: ${finding.message}`);
    if (!sameChecked) console.log(`              checked=${JSON.stringify(result.checked)}`);
  }
}

console.log("");
console.log(
  `${cases.length} cases: ${passed} passed, ${failed} failed, ${known} known-broken, ${fixed} fixed.`,
);
if (known > 0) console.log("Known issues are listed in scripts/README.md.");
if (KEEP) console.log(`kept: ${WORK}`);
else rmSync(WORK, { recursive: true, force: true });
process.exitCode = failed > 0 ? 1 : 0;
