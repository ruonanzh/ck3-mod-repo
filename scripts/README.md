# Maintenance scripts

These scripts are run by the repository maintainer, not by the agent during a mod task. The rules
for each one are in its own header comment.

| Script | What it does | Needs a CK3 install | Writes |
| --- | --- | --- | --- |
| `test-mod-semantics.mjs` | Runs the case matrix for `.pi/lib/mod-semantics.ts` in a temporary directory. | No | Nothing in the repository |
| `check-doc-refs.mjs` | Checks every relative markdown link. Exit 1 when one is broken. | No | Nothing |
| `dump-script-docs.mjs` | Asks the installed game for its name lists (`script_docs`) or its GUI data types (`dump_data_types`), then copies the fresh files into `docs/`. | Yes | `docs/script_docs/` or `docs/data_types/` |
| `sync-wiki.mjs` | Fetches the wiki pages and rewrites `docs/wiki/`. `--check` reports drift and writes nothing. | No (needs network) | `docs/wiki/` |

## The mod-semantics case matrix

Run:

```bash
node scripts/test-mod-semantics.mjs
node scripts/test-mod-semantics.mjs --keep   # keep the temporary directory and print its path
```

Node 22.18 or later is required, because the script imports the TypeScript library directly (type
stripping). The script copies `.pi/lib/mod-semantics.ts` and `.pi/lib/game-paths.ts` into a
temporary directory, adds the `.ts` extension to their relative imports, and calls
`analyzeSemantics` on each fixture. It needs no game install and no third-party package.

The fixtures build a small vanilla mirror and a set of mods. The name check reads the three
committed dumps (`effects.log`, `triggers.log`, `modifiers.log`) from `docs/script_docs/`. The
script writes only under the operating system's temporary directory, and it deletes that directory
unless `--keep` is given.

### Cases

| Case | Fixture | Expected |
| --- | --- | --- |
| `override-vanilla-trait` | A mod overrides `brave` and adds no loc key. | No finding. |
| `new-trait-full-loc` | New trait with `trait_<key>` and `trait_<key>_desc`. | No finding. |
| `new-trait-no-loc` | New trait with no loc key. | One WARN that names both keys. |
| `new-trait-name-only` | New trait with the name key only. | One WARN for `trait_<key>_desc`. |
| `decision-desc-field` | New decision with `desc = { ... }` and the `<key>` loc key. | No finding. |
| `decision-no-loc` | New decision with no loc key. | One WARN that names `<key>` and `<key>_desc`. |
| `decision-title-override` | New decision with `title` and `desc` overrides, plus their loc keys. | No finding. |
| `character-interaction-ok` | New interaction with its `<key>`. | No finding. |
| `character-interaction-no-loc` | New interaction with no loc key. | One WARN for `<key>`. |
| `near-miss-and-exemptions` | One-edit, two-edit, and first-character typos; a saved scope; `random_traits`; a typo in a comment and in a string; an unrelated long name. | Three WARNs for the three typos; everything else is silent. |
| `cross-file-and-inline-definitions` | A scripted effect defined in one file and called from another; an inline `scripted_effect`. | No finding. |
| `short-names-are-not-compared` | A seven-character name. | No finding. |
| `vanilla-field-is-known` | A field that vanilla uses but no definition list holds (`random_traits`). | No finding. |
| `icon-nested-desc` | A new trait whose `icon` block holds a nested `desc` and has no `trait_<key>_desc`. | One WARN for `trait_<key>_desc`. A nested field is not the trait's own `desc`. |
| `indented-definition` | A new trait whose top-level definition is indented. | One WARN for the missing keys. |
| `bom-before-first-definition` | A `.txt` file that starts with a UTF-8 BOM. | One WARN for the missing keys. |
| `missing-mirror` | No `game-scripts/` directory; the dumps exist. | One `mirror-missing` NOTE; no check runs. |
| `mirror-without-dumps` | A mirror; no `docs/script_docs/`. | The loc WARN and one `dump-missing` NOTE; one check runs. |
| `empty-dumps` | A mirror; `effects.log` and `triggers.log` are empty. | The loc WARN and one `dump-missing` NOTE; one check runs. |
| `partial-mirror` | `game-scripts/vanilla/game/common/` exists, but none of the twelve data directories. | One `mirror-incomplete` NOTE; no check runs. |
| `partial-mirror-one-dir` | Only `common/traits/` exists. | One `mirror-partial` NOTE; both checks run against what is present. |
| `partial-dumps` | `effects.log` is empty; `triggers.log` and `modifiers.log` exist. | One `dump-partial` NOTE; both checks run. |

The default run must print `22 cases: 22 passed, 0 failed`. A known defect would be marked with a
`known` flag in the script and reported as `KNOWN`; this matrix currently has none. The four defects
that the review found in the first version (the decision `title` override, a nested `desc` that hid
a missing key, indented/BOM definitions, and the partial mirror) are fixed in
`.pi/lib/mod-semantics.ts`, and these cases are their regression net. If one of them regresses, the
run exits with code 1.

## What the matrix does not cover

- **`validate_mod` end to end.** `mod-lint.ts` imports `typebox` and the pi extension API, so it
  runs inside pi, not in this standalone harness. The semantic result is the same function that the
  matrix calls; the integration is covered by a `validate_mod` call in a pi session.
- **`dump-script-docs.mjs`.** The positive path launches CK3. The argument handling and the spawn
  path need a separate check.
- **`sync-wiki.mjs`.** It needs network access, and a run rewrites `docs/wiki/`.

## The real-game check

The matrix uses a synthetic mirror, so it proves the logic and not the game data. For a check
against real content, in a workspace where `try_set_game_dir` has recorded the game:

1. Run `sync_game_scripts` to fill `game-scripts/vanilla/game/`.
2. Run `validate_mod` on a few installed Workshop mods.

The review run on 2026-10-19 used five Workshop mods (`2234706894`, `2837398670`, `2962238514`,
`3030427202`, `3276373926`) on CK3 1.20.1. All five returned `PASS` with no semantic WARN, in 3 to 5
seconds each. That result is machine-specific: the Workshop set and the installed version are not
fixtures, so the command is documented here and not automated.

The mirror for that run held 19,699 files and 535 MB.
