# docs/wiki/

Reference pages from the CK3 wiki, shipped as a **snapshot** so the agent can answer questions the
mod scripts cannot: the exact name, parameters, and scope of an effect, trigger, modifier, or scope.

The live wiki (`ck3.paradoxwikis.com`) sits behind a JavaScript challenge, and a subagent cannot
fetch it. This copy is the offline substitute. It does not replace `game-scripts/`: the vanilla
scripts show **usage**, and these pages show **fields and scope**.

## What is here

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
| `Event_modding.md` | The most common entry point: events, options, portraits |

Feature guides that only restate what a vanilla file shows are **not** here. Read the vanilla file.

## Source and license

- Source: [`jesec/ck3-modding-wiki`](https://github.com/jesec/ck3-modding-wiki), an automated mirror
  of the official CK3 wiki. Checked against mirror `master` (57 pages).
- License: **CC BY-SA 3.0**. See [`LICENSE`](LICENSE). Each page keeps its original `Source:` line
  and gains a provenance header.
- Every page says how old it is: `Effects_list.md` and `Triggers_list.md` state that they are
  transcribed and may miss effects added after launch.

## Refreshing

```bash
node scripts/sync-wiki.mjs          # fetch and rewrite the pages
node scripts/sync-wiki.mjs --check  # report drift; exit 1 when a page differs
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

**Measured on 1.20.1.1** (this workspace, 2026-10-17): the dump holds **2128** effects, **1937**
triggers, and **761** modifier entries (152 of them templated, such as `$CULTURE$_opinion`); the
wiki lists hold 1156, 1072, and 383. Roughly **47 %** of the dumped names are missing from the wiki,
and **85** wiki names no longer exist — `every_participant` became `every_memory_participant`, and
`complete_activity` became `invalidate_activity`. Treat the dump as the truth and the wiki page as a
explanation with examples.

This also settles the reviewer's two remaining blind spots: with `script-docs/` present, a name that
is absent from the wiki can be checked against the dump, and a call that fails there is genuinely
wrong rather than "not in the snapshot".
