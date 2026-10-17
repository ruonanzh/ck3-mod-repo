# docs/wiki/

Two indexes, on purpose:

- **[`INDEX.md`](INDEX.md)** — every page in the wiki mirror, all **57**, one row each: title,
  whether it is shipped locally, and a one-line description. Use it to answer "does a page for X
  exist".
- **This file** — what is shipped (36 pages), what is not (21), and why.

---

Reference pages from the CK3 wiki, shipped as a **snapshot** so the agent can answer questions the
mod scripts cannot: the exact name, parameters, and scope of an effect, trigger, modifier, or scope.

The live wiki (`ck3.paradoxwikis.com`) sits behind a JavaScript challenge, and a subagent cannot
fetch it. This copy is the offline substitute. It does not replace `game-scripts/`: the vanilla
scripts show **usage**, and these pages show **fields and scope**.

## What is here

Two groups. **Both are needed**: the first answers "what is the exact form of this call", the second
answers "how do I add X" before the player asks.

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

**Cover the questions, not the pages.** A player question arrives without warning, and a subagent
cannot fetch, so every "how do I add X" that the game supports needs one page here. That is why the
feature guides are in, even though some restate what a vanilla file shows: the vanilla file shows
*one example*, the guide explains *every field*.

Excluded on purpose, and fetched on demand. Each entry names the reason, so a reader can decide
whether the miss matters:

| Page | Why it is not here |
| --- | --- |
| `Modding`, `Mod_structure`, `Localization`, `Effects`, `Triggers` | The workspace already covers these: `docs/game.md`, `docs/ck3-modding-conventions.md` (sections 3 and 5), `docs/wiki/Scripting.md`, and the two lists |
| `Map_modding`, `Terrain_modding`, `Coat_of_arms_modding`, `3D_models`, `Sound_modding`, `Music_modding`, `Fonts`, `Graphical_assets` | The graphics and audio pipeline. Needed only for an asset mod; fetch the one page then |
| `Console_commands`, `Commands` | Console and debug commands. Not part of writing a mod |
| `Defines`, `Lists`, `List_of_baronies`, `Exporters` | Data tables and tools. `common/defines/` in the vanilla scripts answers the first |
| `Data_types` | `scripts/dump-script-docs.mjs --command=dump_data_types` regenerates it version-exact |
| `Modding_tools` | Tooling advice for humans, not for the agent |

## Source and license

- Source: [`jesec/ck3-modding-wiki`](https://github.com/jesec/ck3-modding-wiki), an automated mirror
  of the official CK3 wiki. Checked against mirror `master` (57 pages).
- License: **CC BY-SA 3.0**. See [`LICENSE`](LICENSE). Each page keeps its original `Source:` line
  and gains a provenance header.
- Every page says how old it is: `Effects_list.md` and `Triggers_list.md` state that they are
  transcribed and may miss effects added after launch.

## Refreshing

```bash
node scripts/sync-wiki.mjs          # fetch and rewrite the pages, and rebuild INDEX.md
node scripts/sync-wiki.mjs --check  # report drift; exit 1 when a file differs
```

The script drops `../assets/` image references (8 MB of icons the text does not need) and rewrites a
link to a page outside this set into the absolute wiki URL, so the internal link check stays green.

## The authoritative alternative

The wiki pages are a **transcription**, and their own header says they are outdated. The game itself
produces the same data for the exact installed version. Run:

```bash
node scripts/dump-script-docs.mjs          # mirrors the logs into game-scripts/script-docs/
```

The script runs the game headless and copies the result. It relies on three options, two of them in
`game/_commandline_options.info` (the wiki does not document the console action):

```
ck3.exe -nographics -debug_mode -run_console_action=script_docs
```

| Command | Writes |
| --- | --- |
| `script_docs` | `effects.log`, `triggers.log`, `modifiers.log`, `event_scopes.log`, `event_targets.log`, `on_actions.log` |
| `dump_data_types` (`--command=dump_data_types`) | the GUI data types, promotes, and functions |

They land under `<Documents>/Paradox Interactive/Crusader Kings III/logs/`. `Documents` can be moved;
the script asks the registry, then checks the file times to prove the run wrote them. `game-scripts/`
is git-ignored, so the mirror is never committed.

**Mods show up in one log, not the rest.** Measured on 1.20.1.1, with one workshop mod enabled
(`enabled_mods: ["mod/ugc_2837398670.mod"]`) and the same command:

| Log | With the mod |
| --- | --- |
| `effects.log`, `triggers.log`, `modifiers.log`, `event_scopes.log`, `event_targets.log` | **byte-identical in content** (same names) |
| `on_actions.log` | **+60 entries** — the mod's own `timurid_invasion_on_action`, `fatimid_invasion_on_action`, … |

The split is not arbitrary. Effects, triggers, and modifiers are **code** objects, and PDXScript has
no compile step, so a mod cannot add one; its `scripted_effects` and `scripted_triggers` never enter
those logs (verified: a vanilla scripted effect is absent too). `on_actions` are **script** objects,
so anything a mod declares appears. **Dump with an empty playset** for a vanilla baseline; the script
says `playset: no mods enabled`, or prints a NOTE that on_actions will include the mods' entries.

`modifiers.log` also varies in **line order** between runs with the same content; compare name sets,
not the raw file.

**Measured on 1.20.1.1** (this workspace, 2026-10-17): the dump holds **2128** effects, **1937**
triggers, and **761** modifier entries (152 of them templated, such as `$CULTURE$_opinion`); the
wiki lists hold 1156, 1072, and 383. Roughly **47 %** of the dumped names are missing from the wiki,
and **85** wiki names no longer exist — `every_participant` became `every_memory_participant`, and
`complete_activity` became `invalidate_activity`. Treat the dump as the truth and the wiki page as a
explanation with examples.

This also settles the reviewer's two remaining blind spots: with `script-docs/` present, a name that
is absent from the wiki can be checked against the dump, and a call that fails there is genuinely
wrong rather than "not in the snapshot".
