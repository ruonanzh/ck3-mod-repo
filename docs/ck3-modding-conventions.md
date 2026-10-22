# CK3 modding conventions (cheat-sheet)

A committed, retrieval-oriented reference for writing CK3 mods. It explains the reason behind the rules that `validate_mod` enforces. It also explains the load-order and override semantics that the tool cannot check on its own. This is the **knowledge layer**: read it for guidance. It runs and enforces nothing.

- Enforcement lives in `.pi/extensions/mod-lint.ts` (the `validate_mod` tool) for the syntax and the conventions, and in `.pi/lib/mod-semantics.ts` for the name-level checks.
- This document is the **single source of truth** for the modding rules. `AGENTS.md` and `.pi/skills/mod-creator/SKILL.md` reference it instead of repeating the rules.
- The boundaries and the mandatory `validate_mod` step live in [`AGENTS.md`](../AGENTS.md). The step-by-step procedure, with the product shapes and the `validate_mod` usage, is in [`../.pi/skills/mod-creator/SKILL.md`](../.pi/skills/mod-creator/SKILL.md).
- A mod is PDXScript text only. The game engine is C++, and it is out of scope. A mod cannot add behavior that the engine does not expose.

> Sources: the CK3 wiki grounds the mechanics below. Online pages:
> [Modding](https://ck3.paradoxwikis.com/Modding) (override rules and load order),
> [Mod structure](https://ck3.paradoxwikis.com/Mod_structure) (descriptor and mod directory),
> [Localization](https://ck3.paradoxwikis.com/Localization). The live wiki may be behind a JavaScript
> challenge. A mirror lives at `jesec/ck3-modding-wiki`. Some pages are flagged "requires
> verification" or "last verified for an older version", and where that matters this page notes it.

## 1. Overriding vanilla: file overwrite, LIOS, and FIOS

CK3 loads the mod files on top of the vanilla files. There is **no** `INJECT:`/`REPLACE:` keyword system. Those are Victoria 3 / EU5 keywords, and they do not appear anywhere in CK3's docs or vanilla scripts. Override is file- and object-based, per `Modding`, section "Override rules".

- **Full file override:** a mod file with the *same path and filename* as a vanilla/DLC file replaces it entirely. Anything you omit is lost — brittle across patches.
- **Single-object override (script data):** a new file in the same directory with a name later in **ASCIIbetical** order redefines an object from an earlier file. This is **Last In Only Served** (LIOS): `01_defines.txt` wins over `00_defines.txt`.
- **GUI `type`/`template` is the opposite — First In Only Served (FIOS):** name the file to sort first, e.g. `00_my_buttons.gui`, so your definition loads before the one it replaces.
- **`on_actions`:** `events`, `random_events`, and `on_actions` **append**. A `trigger` or `effect` **overwrites** (and produces errors). See `Modding`, section "Override rules".
- **Only a top-level declaration can be overridden.** The declaration starts at the beginning of a line, and it is not inside a block. A nested field is not an override target.
- **A single-object override can change an object, but it cannot delete one.** To remove an object, replace its whole file, or leave it in place and disable its use.
- **Some entities cannot be single-object-overridden** — a single event, faith, or building has no per-object override, so the whole file must be replaced.

**Rule of thumb:** prefer additive new objects. Use a later ASCIIbetical filename for a surgical object override, and reserve full-file overwrite for when you must change most of a file. There is no keyword to prefix. The filename order is the mechanism.

## 2. Load order (ASCII order, plus an unverified subdirectory rule)

Per `Modding`, sections "Mod load order" and "Override rules":

- Files load in **ASCIIbetical order** by name: `00_foo.txt` before `01_bar.txt`. The same order decides two files at the same relative path, so the later name wins.
- **A file in a subdirectory loads after the files in the parent directory**, regardless of ASCII order. *(This rule is stated by the EU5 wiki and is **not yet verified for CK3**. Treat it as "likely, to confirm" until checked against a CK3 install.)*
- Ordering-prefix idioms tune the ASCII position only:
  - `00_...` forces an **early** load, for base definitions that others build on.
  - `zz_...`, `98_...`, and `99_...` force a **late** load.
- **Within a playset**, mods load top-to-bottom, and the **lower** mod overwrites identical files from the one above.

## 3. Localization (BOM, filename, header, and the `replace/` directory)

Write the files under `your_mods/<name>/localization/<lang>/...`. A `.yml` outside `localization/` is not read. The format is in `Modding`, the localization section: BOM, filename, and header. The `replace/` directory is in `Localization`.

- **Encoding (mandatory):** UTF-8 **with BOM** (`EF BB BF`). The wiki lists it first among the localization file rules (`Localization`: "must use UTF-8 BOM encoding"). The linter reports a missing BOM as an ERROR.
- **Filename:** the wiki requires the name to include `l_<language>` (`Localization`: "must include `l_<language>` in their name", for example `my_locs_l_english.yml`). This repository requires the token at the **end**, as `_l_<language>`, because the linter reads the language from the end. The leading part is free-form. The linter anchors `<language>` to the directory.
- **Header:** the first content line is `l_<lang>:`, and it must match the language **directory** (`.../localization/english/...` gives `l_english:`).
- **Entry format:** an indented `  key: "value"`, or `  key:0 "value"` with an explicit version number (the `:0` version is deprecated/no-op for modders). The value starts at the first `"` and ends at the last unescaped `"` on the same line. Placeholders such as `[Scope.GetName]`, escapes such as `\n`, and nested calls such as `[Localize('other_key')]` all live inside the quoted value.
- **Overriding vanilla loc keys:** the mechanism is a `replace` **subdirectory**. Both `localization/replace/<lang>/` and `localization/<lang>/replace/` work, and, per the wiki, `localization/replace/<lang>/` **takes precedence**. Prefer `localization/replace/<lang>/`.
- **No duplicate keys** within one file. They are ambiguous and easy to miss, and the linter flags them.
- **The languages this game ships (9):** `english`, `french`, `german`, `japanese`, `korean`, `polish`, `russian`, `simp_chinese`, `spanish`. A language outside this set is an ERROR that names the language and the accepted set. Renaming the file cannot fix it: either use a shipped language, or accept that the game ignores the file. The list is `LOC_LANGUAGES` in `.pi/extensions/mod-lint.ts`, and that is the one place to change it.

## 4. Brace and quote balance (PDXScript and GUI)

These four rules describe engine behavior. The wiki pages in this repository do not state them, so they are recorded here from the engine and not quoted from a page.

- Every `.txt`, `.gui`, `.gfx`, or `.asset` file under the mod root must have balanced `{ }` and balanced `"`. An extra `}` or an unterminated string breaks the parse of the file. The game often drops everything after it, without a message.
- A `#` starts a line comment **outside** a quoted string. Inside a string, `#` is literal. For example, the loc markup `#italic ... #!` lives inside the quotes.
- **A GUI string can span several physical lines.** A datamodel expression such as `visible = "[Or( ... )]"` legitimately wraps across lines, and the closing `"` can be several lines below the opening one. That is correct, as long as the string eventually closes.
- A file whose extension is not `.txt`/`.gui`/`.gfx`/`.asset` (a `README.md`, a UTF-16 image) is not checked for braces. CK3 has no `in_game/`/`main_menu/` split, so the linter checks every `.txt`/`.gui`/`.gfx`/`.asset` file anywhere under the mod root, including a `tools/` subdirectory.

## 5. `descriptor.mod` and `<name>.mod`

Per `Mod_structure`, sections "The .mod files" and "Keys": every mod ships **two** key=value text files (NOT `.metadata/metadata.json`, which is a Victoria 3 / EU5 format).

- **`descriptor.mod`** — inside the mod directory. Holds `version` (required), `name` (required), `tags`, `picture`, `remote_file_id` (Workshop upload only), and `replace_path`. It does **not** need `path`.
- **`<name>.mod`** — alongside the mod directory (in the Paradox `mod/` directory). The launcher reads this to discover the mod. It holds the same keys **plus** `path` (required) and `supported_version` (required here). `path` points at the mod directory, e.g. `path="mod/my_mod"`.

Keys table (per `Mod_structure`):

| Key | Required | Meaning |
| --- | --- | --- |
| `version` | yes | The mod version, a string. |
| `name` | yes | The launcher display name. |
| `supported_version` | in `<name>.mod` | Latest game version the mod supports. The game uses semantic versioning `MAJOR.MINOR.PATCH`, and `*` wildcards define a range, e.g. `1.20.*`. A wildcard above the patch level (`1.*`, `*`) is a WARN, because it goes stale. |
| `path` | in `<name>.mod` | Where the mod directory lives. Relative to the CK3 user folder (`…/Paradox Interactive/Crusader Kings III/`, so `path="mod/my_mod"`) **or an absolute path** (`path="C:/Mods/my_mod"`). |
| `tags` | no | A list of quoted strings, `tags={ "a" "b" }`. A list may span several lines. |
| `picture` | no | The thumbnail image file, e.g. `"thumbnail.png"`. Steam ignores this key and always looks for `thumbnail.png` in the mod root. |
| `remote_file_id` | Workshop only | The Steam Workshop item id. |
| `replace_path` | no | Skips the vanilla files at a path. |

Syntax: `key="value"` for scalars, `key={ "a" "b" }` for lists, and `#` starts a single-line comment. A list may span several lines. Real workshop mods write `tags` that way:

```txt
tags={
	"Gameplay"
	"Balance"
}
```

The `.metadata` directory does not exist. The mod image is a `thumbnail.png` at the mod root referenced by `picture="thumbnail.png"`. `picture` is optional. `validate_mod` warns in two cases: the mod root holds an image but the key is absent, or the key names a file that the mod root does not hold.

**Who writes `supported_version`.** The game needs it in `<name>.mod`. This repository keeps the value in `descriptor.mod` (so `validate_mod` can check it, and the mod is self-describing), and `install_mod` copies every descriptor key into the generated `<name>.mod`. When the descriptor omits it, `install_mod` derives `MAJOR.MINOR.*` from the recorded game build and writes that, so the pointer file is complete either way.

## 6. Housekeeping

- Edit only under `your_mods/<name>/`. Treat `docs/`, `.pi/`, and `reference/` as read-only. The game directory lives on the player's machine. `try_set_game_dir` records it as `gameDir`, and it is a read-only reference.
- Do not leave scratch files or backup files under `your_mods/<name>/`. Examples: `temp_*`, `_tmp_*`, and editor backups.

### The mod install path must be ASCII

The engine reads a mod whose path contains a non-ASCII character as having **no files inside**. The mod then loads with nothing in it, and no mod content change repairs that: the character is in the path, not in the mod.

- The usual cause is a Windows user profile whose name is not ASCII, because the Paradox mod directory sits under `Documents`: `%USERPROFILE%\Documents\Paradox Interactive\Crusader Kings III\mod`.
- The rule covers the whole path to the mod directory, so it also covers every parent directory. The directory this repository names itself is `lower_snake_case`, so it is ASCII. Only the parent path can carry the non-ASCII character.
- **Where this is stated:** the wiki states it too, in `Mod_structure` under "Creating initial files", as a launcher constraint on the Create-a-Mod directory: *"Directory cannot include non English characters. If your Windows account name have such characters you must use a directory outside your Documents folder."* The quote keeps the wiki's own wording. The Paradox forum thread "Non-ASCII path to the folder breaks mods and opening the error log" reports the engine side effect (the mod loads with no files).
- **The escape hatch the wiki gives:** `path` may be an **absolute path**, not only `path="mod/<name>"` (wiki `Mod_structure`, keys table: *"Alternatively, one can use the entire path"*). So the mod directory can live outside `Documents` under an ASCII path, and the pointer file points at it. A mod directory that stays under a non-ASCII `Documents` path cannot be repaired.
- **What the tools do:** `check_game_paths` and `install_mod` both report a **WARN** and list the offending characters. Neither refuses: the player may not be able to change the directory, and the mod itself cannot repair it. `install_mod` installs anyway and says that the game may load the mod with no files. `get_game_info` adds a NOTE.
- **What the player must do:** when the mod shows up but does nothing in the game, move the mod install directory to an ASCII path, for example by relocating the Windows `Documents` directory, then run `try_set_game_dir` with no arguments and install again. Do not rename the mod.

## 7. Choosing an entry mechanism

CK3 hooks new content into the game through a small number of **entry points**. They are not interchangeable: a feature that reports a one-off choice is an event, a feature that adds a button to a screen is a scripted GUI, and a feature that adds a player action is a decision or a character interaction. Most mods need one of them at most, and many need none.

Pick the entry **before** you write script. Read the row that matches your feature, then open the directory it names and read one of the examples in it. Every path in the table exists in the build that [`wiki/README.md`](wiki/README.md) records.

| Entry point | Use it when | Defined in / read this example |
| --- | --- | --- |
| `character_interactions` | The action becomes available **after the player selects a character** (the interaction fires on that character). | `common/character_interactions/`, e.g. `00_alliance.txt` |
| `decisions` | The action is a **player decision** (visible in the decisions view). | `common/decisions/`, e.g. `00_artifact_decisions.txt` |
| `events` | The feature surfaces as an **event popup** (a one-off window with a choice or a notification). | `events/` (top-level, not under `common/`), e.g. `birth_events.txt` |
| `on_action` | The feature reacts to an **existing hook** (e.g. on_birth, on_death, on_game_start). | `common/on_action/` |
| `scripted_guis` | The feature needs a **custom panel** (its own buttons or widgets on the interface). | the definition in `common/scripted_guis/` and the layout under `gui/` |
| `activities` / `schemes` | The feature is a CK3 **activity** or **scheme**. | `common/activities/`, `common/schemes/` |

A mod can also add its own content to one of the game's data directories, such as scripted effects, script values, traits, or modifiers. The `mod-creator` skill lists the common ones.

**Decide this before you write any script: does this version need its own panel, or any new entry point at all?** If it does, open the directory that the row names, read one of the examples there, then write. If it does not, skip this whole page.

---

## 8. Glossary (one concept, one spelling)

Check every term against this list. It is short on purpose: it holds the words where two spellings would change a reader's decision. The list governs the text this repository writes. The pages under `docs/wiki/` are a transcription of the community wiki, and their own wording stays as it is.

### 8.1 Paths and locations

| Concept | The only spelling | Do not write |
|---|---|---|
| The CK3 install directory | `game directory` | `game install directory`, `game folder` |
| The workspace root | `workspace root` | `repo root` |
| The mod's own directory | `mod directory` | `mod folder`, `mod dir` |
| The directory that holds installed mods | `mod install directory` | `launcher dir`, `install target` |
| The player's Documents tree | `Paradox user-documents directory` | `user documents folder` |
| The Steam Workshop directory | `Steam Workshop directory` | `Workshop folder`, `workshop dir` |
| `game-scripts/` | `the modding context` | `the authoring context`, `the script mirror`, `the mirror` |
| `game-scripts/vanilla/game/` | `the vanilla scripts` | `vanilla` for the whole mirror |
| `game-scripts/workshop/` | `the Workshop scripts` | `vanilla` for the Workshop scripts |
| `docs/script_docs/` | `the game's dumps` | `the logs` |
| The state file | `.gamer-agent.local.json` | `the JSON file`, `state file` |
| A directory | `directory` | `folder` |

A path and a game-content directory use `directory`. `folder` stays only inside a literal, such as `create_mod_folder` or `libraryfolders.vdf`.

### 8.2 Game and mod concepts

| Concept | The only spelling | Do not write |
|---|---|---|
| The person who runs the game | `the player` | `the user` |
| The script language | `PDXScript` | `PDX script`, `PDX-script` |
| The mod type name | `pdx-script` | `PDXScript` |
| Original game content | `vanilla` (adjective) | `base game` |
| The launcher's list of active mods | `playset` | `playlist` |
| The thing that a mod holds | `mod` (noun) | `artifact`, `plugin` |

### 8.3 Three words that are not synonyms

| Word | Meaning | Example |
|---|---|---|
| `override` | The general concept: a mod covers vanilla content | The three override mechanisms |
| `overwrite` | A whole-file change: same path, same filename | A direct file overwrite |
| `replace` | The `replace/` localization subdirectory | An implicit replace |

### 8.4 The three names of one mod

| Concept | The only spelling | Note |
|---|---|---|
| The directory under `your_mods/` | `directory name` | It becomes the install directory name |
| The `name` key in `descriptor.mod` | `mod name` | The launcher and the game show it to the player |
| The `<name>.mod` pointer file | `pointer file` | The launcher discovers the mod through it |

CK3 has no `metadata.id`. The directory name is the identity that this repository controls.

### 8.5 Action and result words

| Concept | The only spelling | Do not write |
|---|---|---|
| Check a path | `check` (`check_game_paths`, `check_runtime`) | `verify`, `double-check` |
| Check a mod | `validate` (the verb for `validate_mod`) | `lint` (verb) |
| Ask the player to agree | `confirm` (only for the player) | `ask for confirmation` |
| Delete a file | `delete` | `remove`, `erase` |
| Write a mod | `write` | `author` |
| The activity of making mods | `modding` | `authoring` |
| Copy the game and Workshop scripts into the modding context | `mirror` | `copy down`, `download` |
| Copy a mod into the mod install directory | `install` | `deploy`, `publish` |
| A mod passed | `valid` | `correct` |
| A path check passed | `correct` | `verified` |
| A path is not in `.gamer-agent.local.json` | `not recorded` | `missing`, `unset` |
| The caller passed no path | `not given` | `missing`, `undefined` |

## 9. Name-level checks (what `validate_mod` proves, and what it does not)

`validate_mod` reads three sources: the mod, the vanilla scripts in `game-scripts/vanilla/game/`, and the game's own dumps in `docs/script_docs/`. These two name checks report WARN or NOTE only, never FAIL, and every finding names the file. The syntax and localization checks in section 3 still report ERROR.

1. **A new object needs its localization key.** The key is derived from the object name, so a new object cannot borrow a vanilla key.
   - `common/traits/`: `trait_<key>` and `trait_<key>_desc`. The wiki states both, in `docs/wiki/Trait_modding.md`.
   - `common/decisions/`: `<key>` and `<key>_desc`. The wiki lists four entries. The tool checks these two, which are the two the player always sees. It does not require `_tooltip` or `_confirm`: `common/decisions/_decisions.info` gives both of them a default, and many mods rely on that default. Those two are unchecked.
   - `common/character_interactions/`: `<key>`. The name field defaults to the interaction key (`common/character_interactions/_character_interactions.info`). The wiki page has no localization section, so the tool checks no other key.
   - A scripted effect, an on_action, and a scripted GUI need no key. The wiki states no key for them, and vanilla ships them without one. A block that sets `name` (a trait), `title` or `desc` (a decision), or `desc` (a trait) supplies that key itself, so the derived key is not required. An object whose name vanilla already declares is an **override**. Vanilla supplies the key, so the mod needs no new one, and the check skips it. A missing key is an error at load, not a cosmetic problem: `game/events/_events.info` states that missing localization keys are logged as errors.
2. **An effect, trigger, or modifier name must be one the game knows.** These are code objects: PDXScript has no compile step, so a mod cannot add one. `docs/wiki/README.md` records the measurement: with a mod enabled, `effects.log`, `triggers.log`, and `modifiers.log` keep the same set of names. The check reports a name when it is one or two edits away from a dumped name, and names the closest one. A name that is far from every dumped name stays silent: it can be a vanilla object, a scripted name, or a name that the mod defines. A word that the vanilla files in the twelve data directories use is also known, because a field such as `random_traits` is correct and appears in no definition list. A misspelling that happens to be one of those words therefore passes silently. Limits: a name shorter than 8 characters is not compared at all. The check compares dumped names only, never a scope or a type. It compares a call position only (`name = …`), so a token on the right of `=` is never reported. The check scans the names that share the first character, then scans every name, so a typo in the first character is compared too. The suggestion is the closest name in the scan, which is not always the name that the mod meant.
3. **Both checks need the modding context.** `game-scripts/vanilla/` is generated by `sync_game_scripts`. Without it, a vanilla object looks new and a vanilla name looks unknown. When the vanilla copy or its `common/` directory is absent, both checks are skipped with one NOTE that names the missing input. The name check also needs `docs/script_docs/`, which is committed, and it reports its own NOTE when the dumps are missing.

**What it does not prove.** A `PASS` does not prove that a new name exists: the game can reject a name that no file uses. The check is not a scope or a type check, and it does not read a value range. Scope belongs to `mod-reviewer` class 5. A value range is outside the review as well: the reviewer marks it `Not checked`.

## Going deeper (the semantics that no check covers)

The linter now checks names, and `mod-reviewer` checks the classes that need judgement: the override form, the placement, the scope, and the type of each call. For exact vanilla names and values, follow the lookup hierarchy in [`INDEX.md`](INDEX.md):

- **Vanilla scripts:** `game-scripts/vanilla/game/`, generated by `sync_game_scripts`, holds the vanilla game scripts. The modding context copies the game directory, so the scripts sit one level down. Grep it for exact object definitions, field values, and loc keys. Never grep the install directory itself. The Workshop scripts are in `game-scripts/workshop/`, one directory per mod, and they are **not** vanilla: a hit there proves that another player wrote it, not that the game accepts it.
- **The wiki reference lists:** [`wiki/`](wiki/README.md) ships the effect, trigger, modifier, and scope lists. Use them for the **form** of a call: its parameters and the scope it needs. A vanilla script shows that a name is used. These lists show how to call it.
- **The official wiki:** ck3.paradoxwikis.com. It has the concepts and worked examples, and can lag a patch behind the game. When it is unreachable, [`wiki/`](wiki/README.md) is the offline substitute.

Both the scripts and the lists can be behind the installed game. The most exact source is the game's own dump, and it carries no build tag: [`wiki/README.md`](wiki/README.md) records the build that the committed dump was measured on. The dump is at `docs/script_docs/`.

What stays out of reach without that dump: a **value domain** (the legal range of a number or the closed set of an enum) and **pairing** beyond the scope column (which host list an object belongs to). Mark such a question `Not checked`.
