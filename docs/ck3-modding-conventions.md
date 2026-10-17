# CK3 modding conventions (cheat-sheet)

A committed, retrieval-oriented reference for writing CK3 mods. It explains the reason behind the
rules that `validate_mod` enforces. It also explains the load-order and override semantics that the
tool cannot check on its own. This is the **knowledge layer**: read it for guidance. It runs and
enforces nothing.

- Enforcement lives in `.pi/extensions/mod-lint.ts` (the `validate_mod` tool).
- This document is the **single source of truth** for the modding rules. `AGENTS.md` and
  `.pi/skills/mod-creator/SKILL.md` reference it instead of repeating the rules.
- The boundaries and the mandatory `validate_mod` step live in [`AGENTS.md`](../AGENTS.md). The
  step-by-step procedure, with the product shapes and the `validate_mod` usage, is in
  [`../.pi/skills/mod-creator/SKILL.md`](../.pi/skills/mod-creator/SKILL.md).
- A mod is PDXScript text only. The game engine is C++, and it is out of scope. A mod cannot add
  behavior that the engine does not expose.

> Sources: the CK3 wiki grounds the mechanics below. Online pages:
> [Modding](https://ck3.paradoxwikis.com/Modding) (override rules and load order),
> [Mod structure](https://ck3.paradoxwikis.com/Mod_structure) (descriptor and mod folder),
> [Localization](https://ck3.paradoxwikis.com/Localization). The live wiki may be behind a JavaScript
> challenge; a mirror lives at `jesec/ck3-modding-wiki`. Some pages are flagged "requires
> verification" or "last verified for an older version", and where that matters this page notes it.

## 1. Overriding vanilla: file overwrite, LIOS, and FIOS

CK3 loads the mod files on top of the vanilla files. There is **no** `INJECT:`/`REPLACE:` keyword
system (those are Victoria 3 / EU5 keywords; they do not appear anywhere in CK3's docs or vanilla
scripts). Override is file- and object-based, per `Modding`, section "Override rules".

- **Full file override:** a mod file with the *same path and filename* as a base-game/DLC file
  replaces it entirely. Anything you omit is lost — brittle across patches.
- **Single-object override (script data):** a new file in the same folder with a name later in
  **ASCIIbetical** order redefines an object from an earlier file. This is **Last In Only Served**
  (LIOS): `01_defines.txt` wins over `00_defines.txt`.
- **GUI `type`/`template` is the opposite — First In Only Served (FIOS):** name the file to sort
  first, e.g. `00_my_buttons.gui`, so your definition loads before the one it replaces.
- **`on_actions`:** `events`, `random_events`, and `on_actions` **append**; a `trigger` or `effect`
  **overwrites** (and produces errors). See `Modding`, section "Override rules".
- **Some entities cannot be single-object-overridden** — a single event, faith, or building has no
  per-object override, so the whole file must be replaced.

**Rule of thumb:** prefer additive new objects. Use a later ASCIIbetical filename for a surgical
object override, and reserve full-file overwrite for when you must change most of a file. There is
no keyword to prefix; the filename order is the mechanism.

## 2. Load order (ASCII order, and a subdirectory after its parent)

Per `Modding`, sections "Mod load order" and "Override rules":

- Files load in **ASCIIbetical order** by name: `00_foo.txt` before `01_bar.txt`. Vanilla compared
  with mod does not matter for ordering; it matters for overwrite precedence, which section 1 covers.
- **A file in a subdirectory loads after the files in the parent directory**, regardless of ASCII
  order. *(This rule is stated by the EU5 wiki and is **not yet verified for CK3**; treat it as
  "likely, to confirm" until checked against a CK3 install.)*
- Ordering-prefix idioms tune the ASCII position only:
  - `00_...` forces an **early** load, for base definitions that others build on.
  - `zz_...`, `98_...`, and `99_...` force a **late** load.
- **Within a playset**, mods load top-to-bottom, and the **lower** mod overwrites identical files
  from the one above.

## 3. Localization (BOM, filename, header, and the `replace/` directory)

Write the files under `your_mods/<name>/localization/<lang>/...`. See `Localization` and
`Modding`, section "Override rules" → "Localization".

- **Encoding (mandatory):** UTF-8 **with BOM** (`EF BB BF`). Without a BOM the game **ignores the
  file**. This failure is fatal, not cosmetic, so the linter treats a missing BOM as an ERROR.
- **Filename (mandatory):** the filename must end with `_l_<language>`, for example
  `council_l_english.yml`. The leading part is free-form. The linter enforces the suffix and anchors
  `<language>` to the directory.
- **Header:** the first content line is `l_<lang>:`, and it must match the language **directory**
  (`.../localization/english/...` gives `l_english:`).
- **Entry format:** an indented `  key: "value"`, or `  key:0 "value"` with an explicit version
  number (the `:0` version is deprecated/no-op for modders). The value starts at the first `"` and
  ends at the last unescaped `"` on the same line. Placeholders such as `[Scope.GetName]`, escapes
  such as `\n`, and nested calls such as `[Localize('other_key')]` all live inside the quoted value.
- **Overriding vanilla loc keys:** the mechanism is a `replace` **subdirectory**. Both
  `localization/replace/<lang>/` and `localization/<lang>/replace/` work, and, per the wiki,
  `localization/replace/<lang>/` **takes precedence**. Prefer `localization/replace/<lang>/`.
- **No duplicate keys** within one file. They are ambiguous and easy to miss, and the linter flags
  them.

## 4. Brace and quote balance (PDXScript and GUI)

- Every `.txt`, `.gui`, `.gfx`, or `.asset` file under the mod root must have balanced `{ }` and
  balanced `"`. An extra `}` or an unterminated string breaks the parse of the file. The game often
  drops everything after it, without a message.
- A `#` starts a line comment **outside** a quoted string. Inside a string, `#` is literal. For
  example, the loc markup `#italic ... #!` lives inside the quotes.
- **A GUI string can span several physical lines.** A datamodel expression such as
  `visible = "[Or( ... )]"` legitimately wraps across lines, and the closing `"` can be several
  lines below the opening one. That is correct, as long as the string eventually closes.
- A file whose extension is not `.txt`/`.gui`/`.gfx`/`.asset` (a `README.md`, a UTF-16 image) is not
  checked for braces. CK3 has no `in_game/`/`main_menu/` split, so the linter checks every
  `.txt`/`.gui`/`.gfx`/`.asset` file anywhere under the mod root, including a `tools/` subdirectory.

## 5. `descriptor.mod` and `<name>.mod`

Per `Mod_structure`, section "Mod structure": every mod ships **two** key=value text files (NOT
`.metadata/metadata.json`, which is a Victoria 3 / EU5 format).

- **`descriptor.mod`** — inside the mod folder. Holds `version` (required), `name` (required),
  `tags`, `picture`, `remote_file_id` (Workshop upload only), and `replace_path`. It does **not**
  need `path`.
- **`<name>.mod`** — alongside the mod folder (in the Paradox `mod/` directory). The launcher reads
  this to discover the mod. It holds the same keys **plus** `path` (required) and `supported_version`
  (required here). `path` points at the mod folder, e.g. `path="mod/my_mod"`.

Keys table (per `Mod_structure`):

| Key | Required | Meaning |
| --- | --- | --- |
| `version` | yes | The mod version, a string. |
| `name` | yes | The launcher display name. |
| `supported_version` | in `<name>.mod` | Latest game version the mod supports; `MAJOR.MINOR.PATCH` with `*` wildcards, e.g. `1.20.*`. |
| `path` | in `<name>.mod` | Where the mod folder lives. |
| `tags` | no | A list, `tags={ "a" "b" }`. |
| `picture` | no | The thumbnail image file, e.g. `"thumbnail.png"`. |
| `remote_file_id` | Workshop only | The Steam Workshop item id. |
| `replace_path` | no | Skips the vanilla files at a path. |

Syntax: `key="value"` for scalars, `key={ "a" "b" }` for lists, and `#` starts a single-line
comment. The `.metadata` directory does not exist; the mod image is a `thumbnail.png` at the mod
root referenced by `picture="thumbnail.png"`.

## 6. Housekeeping

- Edit only under `your_mods/<name>/`. Treat `docs/`, `.pi/`, and `reference/` as read-only.
  The game directory lives on the player's machine. `try_set_game_dir` records it as `gameDir`, and
  it is a read-only reference.
- Do not leave scratch files or backup files under `your_mods/<name>/`. Examples: `temp_*`,
  `_tmp_*`, and editor backups.

### The mod install path must be ASCII

The engine reads a mod whose path contains a non-ASCII character as having **no files inside**. The
mod then loads with nothing in it, and no mod content change repairs that: the character is in the
path, not in the mod.

- The usual cause is a Windows user profile whose name is not ASCII, because the Paradox mod folder
  sits under `Documents`: `%USERPROFILE%\Documents\Paradox Interactive\Crusader Kings III\mod`.
- The rule covers the whole path to the mod folder, so it also covers every parent directory.
- **Where this is stated:** the Paradox forum thread "Non-ASCII path to the folder breaks mods and
  opening the error log" (CK3) and "Vic3 doesn't support loading mods from paths containing non-ASCII
  characters" (the same engine). The wiki pages `Modding`, `Mod_structure`, and `Mod_troubleshooting`
  give the default path but do **not** state the rule as a separate entry, so treat the forum report
  and the engine behaviour as the source.
- **What the tools do:** `check_game_paths` reports a **WARN** and lists the offending characters, because it
  is read-only and the path may be the player's own `Documents` folder. `install_mod` **refuses** the
  path with `TARGET_NOT_ASCII` and changes nothing, because it is the tool that creates the directory:
  **a directory we create ourselves must be ASCII.** `get_game_info` adds a NOTE.
- **What the player must do:** move the mod install directory to an ASCII path, for example by
  relocating the Windows `Documents` folder, then run `try_set_game_dir` with no arguments. Do not
  rename the mod.

## 7. Choosing an entry mechanism

CK3 hooks new content into the game through a small number of **entry points**. They are not
interchangeable: a feature that reports a one-off choice is an event, a feature that adds a button
to a screen is a scripted GUI, and a feature that adds a player action is a decision or a character
interaction. Most mods need one of them at most, and many need none.

Pick the entry **before** you write script. Read the row that matches your feature, then open the
folder it names and read one of the examples in it.

| Entry point | Use it when | Defined in / read this example |
| --- | --- | --- |
| `character_interactions` | The action becomes available **after the player selects a character** (the interaction fires on that character). | `common/character_interactions/`, e.g. `00_alliance.txt` |
| `decisions` | The action is a **player decision** (visible in the decisions view). | `common/decisions/`, e.g. `00_artifact_decisions.txt` |
| `events` | The feature surfaces as an **event popup** (a one-off window with a choice or a notification). | `events/` (top-level, not under `common/`), e.g. `birth_events.txt` |
| `on_action` | The feature reacts to an **existing hook** (e.g. on_birth, on_death, on_game_start). | `common/on_action/` |
| `scripted_guis` | The feature needs a **custom panel** (its own buttons or widgets on the interface). | the definition in `common/scripted_guis/` and the layout under `gui/` |
| `activities` / `schemes` | The feature is a CK3 **activity** or **scheme**. | `common/activities/`, `common/schemes/` |

A mod can also add its own content to one of the game's data folders, such as scripted effects,
script values, traits, or modifiers. The `mod-creator` skill lists the common ones.

**Decide this before you write any script: does this version need its own panel, or any new entry
point at all?** If it does, open the folder that the row names, read one of the examples there, then
write. If it does not, skip this whole page.

---

## Going deeper (semantics the linter does not check)

The linter checks syntax and conventions only. It does **not** check effect, trigger, or modifier
names, and it is not a scope or type validator. For exact vanilla names and values, follow the
lookup hierarchy in [`INDEX.md`](INDEX.md):

- **Vanilla scripts:** `game-scripts/`, generated by `sync_game_scripts`, holds the vanilla game
  scripts and the Workshop scripts. Grep it for exact object definitions, field values, and loc keys.
- **The official wiki:** ck3.paradoxwikis.com. It has the concepts and worked examples, and can lag
  a patch behind the game.
