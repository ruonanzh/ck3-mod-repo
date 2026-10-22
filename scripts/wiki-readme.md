# docs/wiki/

Two indexes, on purpose:

- **[`INDEX.md`](INDEX.md)** — every page in the wiki mirror, all **{{ALL}}**, one row each: title, whether it is shipped locally, and a one-line description. A maintainer writes this file by hand. Use it to answer "does a page for X exist".
- **This file** — what is shipped ({{LOCAL}} pages), what is not ({{EXTERNAL}}), and why. `scripts/sync-wiki.mjs` writes this file from `scripts/wiki-readme.md`, so do not edit it here. `INDEX.md` is the one file a maintainer writes by hand. The {{LOCAL}} shipped pages are transcriptions that carry a provenance header.

---

Reference pages from the CK3 wiki, shipped as a **snapshot** so the agent can answer questions the mod scripts cannot: the exact name, parameters, and scope of an effect, trigger, modifier, or scope.

The live wiki (`ck3.paradoxwikis.com`) sits behind a JavaScript challenge, and a subagent cannot fetch it. This copy is the offline substitute. It does not replace `game-scripts/vanilla/game/`: the vanilla scripts show **usage**, and these pages show **fields and scope**.

## What is here

Two groups. **Both are needed**: the first answers "what is the exact form of this call", the second answers "how do I add X" before the player asks.

### Reference (the form of a call)

| Page | Answers |
| --- | --- |
| `Scripting.md` | Syntax, scopes, operators, saved scopes, variables, iterators, templates |
| `Effects_list.md` | Every code effect: parameters and the scope it needs |
| `Triggers_list.md` | Every trigger: parameters and the scope it needs |
| `Modifier_list.md` | Every modifier and the scope family it belongs to |
| `Scopes.md` | Scope rules and transitions |
| `Scopes_list.md` | Every scope |
| `Variables.md` | Variable syntax and lifetime |
| `Script_values.md` | Script values and their math |
| `Weight_modifier.md` | Weight blocks for random lists |
| `Scripted_effects.md` | Reusable effect blocks |

### How-to coverage (one page per "how do I add X")

| Page | Covers |
| --- | --- |
| `Event_modding.md` | Events, options, portraits |
| `Decisions_modding.md` | Decisions |
| `Interactions_modding.md` | Character interactions |
| `Holdings_modding.md` | Holdings **and buildings** (there is no separate building page) |
| `Trait_modding.md` | Traits |
| `Culture_modding.md` | Cultures and traditions |
| `Religions_modding.md` | Faiths, doctrines, holy orders |
| `Governments_modding.md` | Government types |
| `Title_modding.md` | Titles and succession |
| `Dynasties_modding.md` | Dynasties and houses |
| `Characters_modding.md` | Characters, attributes, and portraits |
| `Lifestyles_modding.md` | Lifestyles and perks |
| `AI_modding.md` | AI personality, weights, and defines |
| `Resources_modding.md` | Resources |
| `Artifact_modding.md` | Artifacts and relics |
| `Regiments_modding.md` | Men-at-arms and units |
| `Council_modding.md` | Council positions and tasks |
| `Struggle_modding.md` | Regional struggles |
| `Story_cycles_modding.md` | Story cycles |
| `History_modding.md` | Historical setup |
| `Bookmarks_modding.md` | Bookmarks and start dates |
| `Interface.md` | The GUI system, for any `.gui` override |
| `Flavorization.md` | Dynamic text and name generation |
| `Customizable_localization.md` | Customizable localization blocks |
| `Mod_compatibility.md` | Load order and conflicts |
| `Mod_troubleshooting.md` | `error.log` and common failures |

### The selection rule

**Cover the questions, not the pages.** A player question arrives without warning, and a subagent cannot fetch, so every "how do I add X" that the game supports needs one page here. That is why the feature guides are in, even though some restate what a vanilla file shows: the vanilla file shows *one example*, the guide explains *every field*.

Excluded on purpose, and fetched on demand. Each entry names the reason, so a reader can decide whether the miss matters:

| Page | Why it is not here |
| --- | --- |
| `Modding`, `Mod_structure`, `Localization`, `Effects`, `Triggers` | The workspace already covers these: `docs/game.md`, `docs/ck3-modding-conventions.md` (sections 3 and 5), `docs/wiki/Scripting.md`, and the two lists |
| `Map_modding`, `Terrain_modding`, `Coat_of_arms_modding`, `3D_models`, `Sound_modding`, `Music_modding`, `Fonts`, `Graphical_assets` | The graphics and audio pipeline. Needed only for an asset mod. Fetch the one page, then |
| `Console_commands`, `Commands` | Console and debug commands. Not part of writing a mod |
| `Defines`, `Lists`, `List_of_baronies`, `Exporters` | Data tables and tools. `common/defines/` in the vanilla scripts answers the first |
| `Data_types` | `node scripts/dump-script-docs.mjs --command=dump_data_types` regenerates it for the installed build, into `docs/data_types/`, which is committed |
| `Modding_tools` | Tooling advice for humans, not for the agent |

## Source and license

- Source: [`jesec/ck3-modding-wiki`](https://github.com/jesec/ck3-modding-wiki), an automated mirror of the official CK3 wiki. Checked against mirror `master` ({{ALL}} pages).
- License: **CC BY-SA 3.0**. See [`LICENSE`](LICENSE). Each page keeps its original `Source:` line and gains a provenance header.
- Every page says how old it is: `Effects_list.md` and `Triggers_list.md` state that they are transcribed and may miss effects added after launch.

## Refreshing

```bash
node scripts/sync-wiki.mjs          # fetch and rewrite the pages, and check INDEX.md rows
node scripts/sync-wiki.mjs --check  # report drift; exit 1 when a page or an INDEX row differs
```

The script drops `../assets/` image references (8 MB of icons the text does not need) and rewrites a link to a page outside this set into the absolute wiki URL, so the internal link check stays green.

## The authoritative alternative

The wiki pages are a **transcription**, and their own header says they are outdated. The game itself produces the same data for the exact installed version. Run:

```bash
node scripts/dump-script-docs.mjs                      # writes the name lists into docs/script_docs/
node scripts/dump-script-docs.mjs --command=dump_data_types   # writes the GUI data types into docs/data_types/
```

The script runs the game headless and copies the result. It relies on three options, two of them in `game/_commandline_options.info` (the wiki does not document the console action):

```
ck3.exe -nographics -debug_mode -run_console_action=script_docs
ck3.exe -nographics -debug_mode -run_console_action=dump_data_types
```

| Command | Writes | Output directory |
| --- | --- | --- |
| `script_docs` | `effects.log`, `triggers.log`, `modifiers.log`, `event_scopes.log`, `event_targets.log`, `on_actions.log` | `<Documents>/Paradox Interactive/Crusader Kings III/logs/` |
| `dump_data_types` | `data_types_common.txt`, `data_types_gui.txt`, `data_types_internalclausewitzgui.txt`, `data_types_script.txt`, `data_types_uncategorized.txt` | `<Documents>/Paradox Interactive/Crusader Kings III/logs/data_types/` |

The two commands write into different directories. `dump_data_types` also prints the path it used: `Data types dumped into '<path>'`. Measured on 1.20.1.1: 5 files, 145 900 lines, 2.6 MB.

`Documents` can be moved. The script asks the registry, then checks the file times in the output directory to prove the run wrote them. It copies the fresh files into `docs/script_docs/` and `docs/data_types/`, which **are committed**: the dumps are repository content, so a clone has them without the game. `validate_mod` reads `docs/script_docs/` for its name-level checks, and nothing reads `docs/data_types/` automatically: it is the reference for GUI work.

**No game session is needed.** The command runs at the `application initialized` stage, before any menu or save is loaded, and the lists are complete there. Measured on 1.20.1.1:

- A **headless** run and a **graphical** run of the same command produced logs that are **byte-identical** for `effects`, `triggers`, `event_scopes`, `event_targets`, `on_actions`, and an identical name set for `modifiers` (that file only varies in line order). Rendering and session state do not feed the lists.
- DLC-gated names are present (`add_amenity_level`, `add_barter_goods`, `add_animate_domicile_building`, `accolade_*`), so the dump is not a vanilla-only subset.
- The **wrong** init stage fails loudly: `-run_console_action_clausewitz` returns `Project does not have modifier documentation function pointer set`. That error is the CK3 analogue of "the docs are incomplete because the game has not started". The fix is the documented stage, not starting a session.
- A name used in vanilla but absent from a list is a **script object**, not a missing entry: `can_be_knight` lives in `common/scripted_rules`, and `scripted_effects`/`scripted_triggers` names never appear either.

The graphical path is not recommended: on this machine it wrote the logs and then crashed in the renderer, while the headless path exits cleanly.

**Mods show up in one log, not the rest.** Measured on 1.20.1.1, with one workshop mod enabled (`enabled_mods: ["mod/ugc_2837398670.mod"]`) and the same command:

| Log | With the mod |
| --- | --- |
| `effects.log`, `triggers.log`, `modifiers.log`, `event_scopes.log`, `event_targets.log` | **byte-identical in content** (same names) |
| `on_actions.log` | **+60 entries** — the mod's own `timurid_invasion_on_action`, `fatimid_invasion_on_action`, … |

The split is not arbitrary. Effects, triggers, and modifier **types** are **code** objects, and PDXScript has no compile step, so a mod cannot add one. A mod can add a static modifier in `common/modifiers/`, which bundles those types (`Modifier_list.md`). Its `scripted_effects` and `scripted_triggers` never enter those logs (verified: a vanilla scripted effect is absent too). `on_actions` are **script** objects, so anything a mod declares appears. **Dump with an empty playset** for a vanilla baseline. The script says `playset: no mods enabled`, or prints a NOTE that on_actions will include the mods' entries.

`modifiers.log` also varies in **line order** between runs with the same content. Compare name sets, not the raw file.

The dump also follows the **session language**: a `Use areas:` line can read `character， province` with a full-width comma on a Chinese session. The `Tag:` name line stays ASCII, so a name check reads `Tag:` only.

The dump carries **no build tag**, and git keeps no file date. The recorded build is the one in the measurement note below, so refresh the dump after a game patch.

**Measured on 1.20.1.1** (this workspace, 2026-10-17): the dump holds **2128** effects, **1937** triggers, and **761** modifier entries (152 of them templated, such as `$CULTURE$_opinion`). The wiki lists hold 1156, 1072, and 383. Roughly **47 %** of the dumped names are missing from the wiki, and **85** wiki names no longer exist — `every_participant` became `every_memory_participant`, and `complete_activity` became `invalidate_activity`. Treat the dump as the truth and the wiki page as a explanation with examples.

This also settles the reviewer's two remaining blind spots: with `docs/script_docs/` present, a name that is absent from the wiki can be checked against the dump, and a call that fails there is genuinely wrong rather than "not in the snapshot".
