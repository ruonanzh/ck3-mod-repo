# CK3 modding docs index

A curated map of the knowledge layer under `docs/`.
**Load selectively.** Read this index first. Then open only the one or two pages that the current
task needs, instead of pulling the whole `docs/` directory into context.

## Lookup hierarchy (which source is authoritative for what)

| You need | Source |
|---|---|
| Exact vanilla object definitions, field values, and loc keys | `game-scripts/` (the script mirror that `sync_game_scripts` generates), or the local game directory recorded by `try_set_game_dir` |
| The parameters and the scope of one effect, trigger, modifier, or scope | [`wiki/`](wiki/README.md), the shipped snapshot of the wiki reference lists |
| Script language rules (syntax, scopes, variables, iterators, templates) | [`wiki/Scripting.md`](wiki/Scripting.md) |
| Mechanics concepts and how-to method (mod API) | the official wiki (ck3.paradoxwikis.com). When it is unreachable, the snapshot under `wiki/` is the offline substitute |
| The modding conventions and the reason behind them | [`ck3-modding-conventions.md`](ck3-modding-conventions.md) |

- **Start here:** [`ck3-modding-conventions.md`](ck3-modding-conventions.md). This cheat-sheet
  covers override (LIOS/FIOS), load order, localization, the `descriptor.mod`/`.mod` metadata, and
  the entry mechanisms. It answers most modding questions on its own. Read the pages below only when
  you need more depth.

> `validate_mod` checks **syntax and conventions** only: balanced braces and quotes, the
> localization format, and the `descriptor.mod` fields. It does **not** check effect, trigger, or
> modifier names, and it is not a scope or type validator. Use `game-scripts/` and the official wiki
> for those.

## Other pages in `docs/`

| Page | Load it when you need to |
|------|------------------------|
| [`game.md`](game.md) | The game overview and the mod loading mechanics. |
| [`ck3-modding-conventions.md`](ck3-modding-conventions.md) | The reason behind the override, load-order, localization, and metadata rules. |
| [`wiki/README.md`](wiki/README.md) | What the wiki snapshot covers, its license, how to refresh it, and how to generate version-exact lists from the game itself. |
