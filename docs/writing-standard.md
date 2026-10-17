# English writing standard

This file governs every English text in `ck3-mod-repo` that an agent reads. The rules come from
ASD-STE100 and the `asd-ste100` skill.

**Read this file before you change an agent-facing English text.** That covers `AGENTS.md`, a
`SKILL.md`, `docs/`, and every string in `.pi/extensions/` that the model sees.

## 1. What this applies to

**Applies:**

1. `AGENTS.md` and `README.md`.
2. `.pi/skills/*/SKILL.md`, including the frontmatter `description`.
3. `.pi/agents/*.md`, including the frontmatter `description`.
4. `docs/INDEX.md`, `docs/game.md`, `docs/ck3-modding-conventions.md`, `reference/README.md`.
5. The `description`, `promptSnippet`, `promptGuidelines`, and parameter `description` strings in
   `.pi/extensions/*.ts` and `.pi/lib/*.ts`.
6. The `content` text and the error text that a tool returns.

**Does not apply:**

1. `docs/wiki/**`: generated from the wiki mirror. Do not hand-edit. Refresh it with
   `scripts/sync-wiki.mjs`.
2. `game-scripts/`: the git-ignored vanilla mirror.
3. Code, code comments, and commit messages. They are for a human reader.
   The strings in item 5 and item 6 still apply, because they are not comments.
4. A quoted game command, log line, or interface label. Keep it as it is.
5. A quoted wiki sentence. Keep it as it is.

## 2. Two modes

Pick the mode before you write.

### 2.1 Strict

**Range:** tool metadata, `content`, error text, the step paragraphs of a `SKILL.md`.

Every rule in section 3 applies, including the sentence-length limit and one-word-one-meaning.

### 2.2 STE-flavored

**Range:** the explanatory prose in `docs/**` and in a `SKILL.md`.

Every structure rule in section 3 applies. The word rules in section 3.1 are a direction, not a
word-for-word replacement. Explanatory prose needs some room to vary.

## 3. Rules

### 3.1 Words

1. **One word, one meaning.** Pick one verb for one action, and use it everywhere. After `check`,
   do not also write `verify` or `confirm` for the same action.
2. **Define before you use.** A CK3 term is defined in section 4. A common word that the reader
   already knows needs no definition.
3. **Use a concrete verb.** Write `analyze the log`, not `perform an analysis of the log`.
4. **Keep a literal as it is.** A path, a command, an identifier, a tool name, a status word, or a
   game keyword stays in its original form, inside backticks. Examples: `game-scripts/`,
   `set_game_dir`, `PASS`, `descriptor.mod`.
5. **A noun string holds at most three words.** Write `the block that sets county development`,
   not `the county development setting block`.
6. **No marketing adjective.** Do not use `seamless`, `robust`, or `cutting-edge`. If you make a
   claim, give the measurement.

### 3.2 Sentences

1. **One fact per sentence.** One sentence holds one action or one fact.
2. **Length limit.** A step sentence holds at most 20 words. A description sentence holds at most
   25 words.
3. **Active voice.** Write who does the action. An exception is allowed when the actor is unknown
   or irrelevant.
4. **Condition first, action second.** Write `If the path is missing, run set_game_dir.`, not
   `Run set_game_dir if the path is missing.`
5. **Simple tense only.** Use the infinitive, the imperative, the simple present, the simple past,
   and the past participle as an adjective. A present perfect is allowed when it carries meaning
   that no simple tense carries.
6. **No semicolon.** Split the sentence.
7. **No phrasal verb.** Write `start`, `read`, `contact`. Write `find` for `look up`.
8. **Keep the hedge.** Do not turn `may`, `can`, or `could` into a fact. `The request may have
   failed.` must not become `The request failed.`
9. **No double negative.**
10. **Do not drop the subject or the article.** If the shorter form has two readings, write the
    full form.

### 3.3 Paragraphs and lists

1. One topic per paragraph, and at most six sentences.
2. Three or more steps become a numbered list. One action per step.
3. Do not end a list with `etc.`, `and so on`, or `…`. Write the full list, or name where the
   full list lives.

### 3.4 Symbols

1. Do not use a symbol to carry a modal, a warning, or emphasis. Do not use `✓`, `✗`, `⚠️`, or
   `⭐`.
2. Do not use an arrow (`→`, `←`) in place of words. Write the sentence.

   | Do not write | Write |
   |---|---|
   | `FAIL: X` → fix Y | If the tool returns `FAIL: X`, fix Y. |
   | the value ← the parameter | The value of that parameter is the value. |

3. Keep the status words `PASS`, `FAIL`, `PARTIAL`, `WARN`, and `NEXT` as they are.
4. Keep an arrow that appears in a log format or in command output.
5. A number, a list marker, a code block, and a table structure are not subject to this section.
   The text inside a table cell follows the prose rules, including rule 1: use a result word from
   section 4.7, for example `correct`, `valid`, or `not recorded`.

### 3.5 Tool return text

1. English or ASCII only. Windows GBK shows a non-ASCII character as garbage.
2. Format: the error code and the reason on one line, a newline, then `NEXT:` and the next step.
3. An error code is uppercase English with underscores. Examples: `INVALID_MOD_DIR`,
   `TARGET_NOT_FOUND`.
4. A failure gives the next action. Never ask the agent to repeat the action that just failed.
5. A business result uses `PASS`, `WARN`, `FAIL`, or `PARTIAL`. A tool error uses `throw`.
6. When a `PASS` line carries a parenthesized label, the label is a result word, not an action
   word. See section 4.7.

## 4. Glossary

One concept has one spelling. One spelling means one concept.

### 4.1 Paths and locations

| Concept | The only spelling | Do not write |
|---|---|---|
| The CK3 install directory | `game directory` | `game install directory`, `game folder` |
| The workspace root | `workspace root` | `repo root` |
| A mod's directory | `mod directory` | `mod folder`, `mod dir` |
| The directory that holds installed mods | `mod install directory` | `launcher dir`, `install target` |
| The player's Documents tree | `Paradox user-documents directory` | `user documents folder` |
| The Steam Workshop directory | `Steam Workshop directory` | `Workshop folder`, `workshop dir` |
| `game-scripts/`: the context to load before writing | `the modding context` | `the authoring context` |
| `game-scripts/game/game/` | `the vanilla scripts` | `vanilla` for the whole `game-scripts/` |
| `game-scripts/workshop/` | `the Workshop scripts` | `vanilla` for the Workshop scripts |
| The state file | `.gamer-agent.local.json` | `the JSON file`, `state file` |
| A directory | `directory` | `folder` |

**One concept has one name.** Do not write the full name first and a short name afterwards. Use the
spelling in the table everywhere.

A path and a game-content directory use `directory`. Examples: `mod directory`, `game directory`,
`language directory`, `subdirectory`. `folder` is allowed only inside a literal, as section 4.2
says.

### 4.2 Literals

The following spellings stay as they are, by rule 3.1.4. They are literals, not another name for a
concept in section 4.

1. **Code identifier:** `cwd`, `gameDir`, `modDir`, `modInstallDir`, `workshopDir`.
2. **Path:** `game-scripts/`, `your_mods/<ModName>`, `.pi/extensions/`.
3. **An identifier that contains `folder`:** `libraryfolders.vdf`, `create_mod_folder`,
   `GAME_FOLDER_NAME`.
4. **Placeholder:** `<userDocuments>`, `<language>`, `<ModName>`, `<name>`.
5. **Tool name:** `try_set_game_dir`, `set_game_dir`, `check_game_paths`, `check_runtime`,
   `install_runtime`, `validate_mod`, `install_mod`, `sync_game_scripts`, `get_game_info`.
6. **Status string:** `PASS`, `FAIL`, `WARN`, `PARTIAL`, `NEXT`.

### 4.3 Game and mod concepts

| Concept | The only spelling | Do not write |
|---|---|---|
| The person who runs the game | `the player` | `the user` |
| The script language | `PDXScript` | `PDX script`, `PDX-script` |
| The mod type name | `pdx-script` | `PDXScript` |
| Original game content | `vanilla` (adjective) | `base game` |
| The thing that a mod holds | `mod` (noun) | `artifact`, `plugin` |
| The launcher's list of active mods | `playset` | `playlist` (the launcher UI says Playsets) |

### 4.4 Three words that are not synonyms

| Word | Meaning | Example |
|---|---|---|
| `override` | The general concept: a mod covers vanilla content | The three override mechanisms |
| `overwrite` | A whole-file change: same path, same filename | A direct file overwrite |
| `replace` | The `replace/` localization subdirectory | An implicit replace |

### 4.5 The three names of one mod

| Concept | The only spelling | Note |
|---|---|---|
| The directory under `your_mods/` | `directory name` | It becomes the install directory name |
| The `name` key in `descriptor.mod` | `mod name` | The launcher and the game show it to the player |
| The `<name>.mod` pointer file | `pointer file` | The launcher discovers the mod through it |

CK3 has no `metadata.id`. The directory name is the identity that this repository controls.

### 4.6 Action words

| Concept | The only spelling | Do not write |
|---|---|---|
| Check a path or a precondition | `check` (tools `check_game_paths`, `check_runtime`) | `verify`, `double-check` |
| Check whether a mod is valid | `validate_mod` (tool name), `validate` (the verb for that tool), `linter` (the category) | `lint` (verb) |
| Ask the player to agree | `confirm` (only for the player) | `ask for confirmation` |
| Delete a file | `delete` | `remove`, `erase` |
| The tool finds the game directory | `locate` | `search`, `hunt for` |
| Write a value into the state file | `record` | `save`, `store`, `persist` |
| Write a mod (verb) | `write` | `author` |
| The activity of making mods | `modding` | `authoring` |
| A rule in the conventions file | `the modding conventions` | `the authoring rules` |
| Copy `game/` and `workshop/` into `game-scripts/` | `mirror` | `copy down`, `download` |
| Copy a mod into the mod install directory | `install` | `deploy`, `publish` |
| Update the workspace code | `update` | `sync`, `pull` |

### 4.7 Result adjectives

| Concept | The only spelling | Do not write |
|---|---|---|
| A path check passed | `correct` | `verified`, `checked`, `valid` |
| A mod passed | `valid` | `correct` |
| A path is not in the state file | `not recorded` | `missing`, `unset` |
| The caller passed no path | `not given` | `missing`, `undefined` |
| An item is optional | `optional` | `may be omitted` |

## 5. How to check

### 5.1 Machine check

The `asd-ste100` skill has `scripts/ste-lint.py`. It reports a semicolon, a long sentence, a
phrasal verb, a light verb, synonym rotation, passive voice, and a compound tense.

```bash
py "D:/desktop-gamer-agent-pi-eu5/.pi/skills/asd-ste100/scripts/ste-lint.py" <file>
```

Exit code 1 means more hard violations than the baseline. A first adoption of an old file may use
`--baseline N`.

The machine check does not cover a hedge, a literal, the glossary, or the tone of a warning. Check
those four by hand.

**Do not feed a `.ts` file to the check.** Code semicolons count as violations. Extract only the
strings first, then check the extracted text, then delete the extract. It is not repository content.

### 5.2 Human check

1. Check every sentence against section 3.
2. Check every term against section 4.
3. Check that each hedge keeps its meaning.
4. Check that each literal is unchanged.
5. Check that the English semicolon count is zero.
6. Check that the shorthand-symbol count is zero.
