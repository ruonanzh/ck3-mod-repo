# reference/

Runnable sample mods that must pass `validate_mod`. Each subdirectory is a complete mod. Do not
edit these files. Copy one as the starting point for a new mod.

## example_mod

The smallest CK3 mod that exercises the real structure:

| Path | Purpose |
| --- | --- |
| `descriptor.mod` | The mod identity: `name`, `version`, `supported_version`, `tags`, `picture`. |
| `thumbnail.png` | The launcher/Workshop image, named by `picture`. |
| `common/decisions/zz_example_decision.txt` | A new decision that grants 100 gold. |
| `localization/english/zz_example_l_english.yml` | The English keys for the decision. |
| `localization/simp_chinese/zz_example_l_simp_chinese.yml` | The simplified-Chinese keys. |

What it demonstrates:

- **Classic layout.** Content directories (`common/`, `localization/`) sit at the mod root. There is no
  `.metadata/` directory and no `in_game/`/`main_menu/` split.
- **A new object is additive.** `example_gain_gold_decision` is a new key, so it cannot clash with
  vanilla.
- **Bilingual localization.** Both files carry the UTF-8 BOM (`EF BB BF`) and the `l_<lang>:`
  header, and name the language with the `_l_<lang>.yml` filename suffix.

To run it: copy the directory to `your_mods/`, run `validate_mod`, then `install_mod`. See
`docs/ck3-modding-conventions.md` for the override rules (LIOS/FIOS) and the entry mechanisms.
