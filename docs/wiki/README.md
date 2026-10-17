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

The wiki pages are a **transcription**. The game itself can produce the same data for the exact
version on the player's machine, with two console commands run in the debug console:

| Command | Writes |
| --- | --- |
| `script_docs` | `effects.log`, `triggers.log`, `modifiers.log`, `event_scopes.log`, `event_targets.log`, `on_actions.log`, … |
| `dump_data_types` | GUI data types, promotes, and functions per window |

Both write under `<user documents>/Paradox Interactive/Crusader Kings III/logs/`. The install also
exposes a command-line hook, which `_commandline_options.info` documents and the wiki does not:

```
ck3.exe -nographics -debug_mode -run_console_action=script_docs
```

`-nographics` runs without a window and `-run_console_action=<cmd>` runs one console command and
exits. That makes a headless dump possible, but it **launches the game**: do it only with the
player's agreement, and only when a version-exact list matters.
