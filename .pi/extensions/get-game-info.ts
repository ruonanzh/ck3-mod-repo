/**
 * get_game_info - it reports the recorded game environment facts in one call. It takes no
 * arguments, it is read-only, and it writes no state.
 *
 * The facts:
 *   - the three paths: gameDir, modInstallDir, and workshopDir;
 *   - supportedGameVersion: the version value for the mod metadata;
 *   - the script layout, whether the vanilla scripts are present, and where the entry points are.
 *
 * The version rule: the tool derives supportedGameVersion from the build tag in the runtime state
 * (`gameBuild`), and it prints the major and the minor version with a wildcard, for example `1.20.*`.
 * It never prints the exact build. Reason: an exact value becomes stale at every game patch, so the
 * game then reads the mod as out of date, and the wildcard stays valid across patch updates. The
 * exact build stays in `.gamer-agent.local.json` for traceability only.
 *
 * Read-only: the tool reads `.gamer-agent.local.json`, and it never writes it. A missing or invalid
 * gameDir is a FAIL, and the agent then runs try_set_game_dir, which records the paths.
 *
 * CK3 facts: the install scripts live in `<gameDir>/game/...`. The vanilla copy lives in
 * `game-scripts/game/game/...`, which carries one more `game/` layer. That copy holds vanilla
 * scripts only, and the agent must count it with `find -L`, because `game-scripts` is a symlink.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { checkGameDir, nonAsciiCharsInPath, pathsFor, readModRepoConfig, readState, supportedGameVersion } from "../lib/game-paths";

/** The label column width of the report. */
const LABEL_WIDTH = 22;
const row = (label: string, value: string): string => `${label.padEnd(LABEL_WIDTH)}${value}`;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "get_game_info",
    label: "Get Game Info",
    description:
      "Reports the recorded game environment facts for Crusader Kings III in one call: the game directory, the mod install directory, the Workshop directory, the supported game version, the script layout, whether the vanilla scripts are present, and where the entry points are. It takes no arguments, it reads the runtime state only, and it writes nothing.",
    promptSnippet: "Report the game paths, the supported version, the layout, and whether the vanilla scripts are present",
    promptGuidelines: [
      "Use get_game_info when you need the game paths, the script layout, whether the vanilla scripts are present, or the version value for the mod metadata. It answers all of them in one call.",
      "Use get_game_info instead of gathering the game version yourself. Write the returned `supportedGameVersion` into `supported_version`. Do not read `ck3.exe`, and do not use its `VersionInfo`.",
      "get_game_info takes no arguments, and it writes nothing. If it returns FAIL, run try_set_game_dir first, which locates the game and records the paths.",
    ],
    parameters: Type.Object({}),
    async execute(_id, _params, _s, _u, ctx) {
      const cwd = ctx.cwd;
      const state = readState(cwd);
      const verdict = checkGameDir(typeof state.gameDir === "string" ? state.gameDir : null);
      if (!verdict.ok || !verdict.path) {
        return {
          content: [
            {
              type: "text",
              text:
                `FAIL: gameDir not recorded - ${verdict.reason ?? "no valid game directory is recorded"}.\n` +
                `NEXT: run try_set_game_dir with no arguments. It locates the game and records the paths.`,
            },
          ],
          details: { ok: false, code: verdict.code ?? "GAME_DIRECTORY_NOT_FOUND", wroteState: false },
        };
      }
      const gameDir = verdict.path;

      // The configuration gives the derived paths. The derived mod install path wins over the
      // recorded one, because the player can move the Documents directory after the tool recorded
      // it, and install_mod uses the derived path. This tool is read-only, so it does not repair
      // the record. The recorded Workshop path wins, because pathsFor does not report a missing one.
      let derived: { modInstallDir: string | null; workshopDir: string | null } | null = null;
      try {
        derived = pathsFor(gameDir, readModRepoConfig(cwd));
      } catch {
        derived = null;
      }
      const modInstallDir = derived?.modInstallDir ?? (state.modInstallDir as string | null | undefined) ?? null;
      const workshopDir = (state.workshopDir as string | null | undefined) ?? derived?.workshopDir ?? null;

      const build = typeof state.gameBuild === "string" ? state.gameBuild : null;
      const version = supportedGameVersion(build);

      // The vanilla copy holds the scripts, and `game-scripts` is a symlink, so the agent counts
      // it with `find -L`. This check reads one directory entry only.
      const vanillaPresent = existsSync(join(cwd, "game-scripts", "game", "game"));

      const lines = [
        "PASS: game info",
        row("gameDir", gameDir),
        row("modInstallDir", modInstallDir ?? "(none - mod-repo.json declares no mod install path)"),
        row("workshopDir", workshopDir ?? "(none - no Workshop directory was found)"),
        row(
          "supportedGameVersion",
          version
            ? `${version}    (write this value into supported_version. Do not gather the version yourself)`
            : "(none - no build tag is recorded, so the version cannot be derived)",
        ),
        row("layout", `install: ${gameDir}/game/...`),
        row("", "vanilla:  game-scripts/game/game/...   (the vanilla copy has one more game/ layer)"),
        row(
          "vanilla",
          vanillaPresent
            ? "present, no workshop mirrored, count with `find -L`"
            : "missing - run sync_game_scripts, then count with `find -L`",
        ),
        row("entry points", "see docs/ck3-modding-conventions.md section 7"),
      ];
      if (!version) {
        lines.push(
          "NOTE: no build tag is recorded for the game, so supportedGameVersion cannot be derived.",
          "NEXT: do not fall back to `1.*` - mod-lint warns on that loose form. Ask the player which game version the mod must support, and write a patch-level wildcard such as `1.20.*` only when the version is known.",
        );
      }
      // Engine rule: a mod at a path with a non-ASCII character is read as having no files inside.
      // Report it here, because every later step inherits the path.
      const badPathChars = modInstallDir ? nonAsciiCharsInPath(modInstallDir) : [];
      if (badPathChars.length > 0) {
        lines.push(
          `NOTE: modInstallDir has non-ASCII character(s) ${badPathChars.map((c) => `'${c}'`).join(", ")}. The game reads a mod at such a path as having no files inside, so install_mod reports a WARN and the game may load the mod empty.`,
          "NEXT: tell the player to move the mod install directory to an ASCII path (for example relocate the Windows Documents folder), then run try_set_game_dir with no arguments.",
        );
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          ok: true,
          gameDir,
          modInstallDir,
          workshopDir,
          supportedGameVersion: version,
          wroteState: false,
        },
      };
    },
  });
}
