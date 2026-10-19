/**
 * get_game_info - it reports the recorded game environment facts in one call. It takes no
 * arguments, it is read-only, and it writes no state.
 *
 * The facts:
 *   - the three paths: gameDir, modInstallDir, and workshopDir;
 *   - supportedGameVersion: the version value for the mod metadata;
 *   - the script layout, whether the vanilla scripts are present, how many Workshop mods the
 *     mirror holds, whether the game's dumps are present, and where the entry points are.
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
 * CK3 facts: the install scripts live in `<gameDir>/game/...`. The mirror copies the game
 * directory, so the vanilla scripts live at `game-scripts/vanilla/game/...`. The workshop part of
 * the mirror is `game-scripts/workshop/`, one directory per mod.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  DUMP_DIRNAME,
  MIRROR_DIRNAME,
  MIRROR_ROOT_DIRNAME,
  NO_WORKSHOP_MARKER,
  checkGameDir,
  dumpDir,
  mirrorDirs,
  nonAsciiCharsInPath,
  pathsFor,
  readModRepoConfig,
  readState,
  supportedGameVersion,
} from "../lib/game-paths";

/** The label column width of the report. */
const LABEL_WIDTH = 22;
const row = (label: string, value: string): string => `${label.padEnd(LABEL_WIDTH)}${value}`;

/** The number of directories under one path. A missing path reports 0. */
function countDirs(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

/** The Workshop row. It reports the state of the mirror, never a fixed claim. */
function workshopRow(cwd: string): string {
  const dirs = mirrorDirs(cwd);
  if (existsSync(join(dirs.root, NO_WORKSHOP_MARKER))) return "not mirrored (.no-workshop is present)";
  if (!existsSync(dirs.workshop)) return "not mirrored - run sync_game_scripts";
  return `${countDirs(dirs.workshop)} mod(s) mirrored`;
}

/** The dumps row. The game's own lists are repository content, so a clone has them without the game. */
function dumpsRow(cwd: string): string {
  try {
    const dir = dumpDir(cwd);
    const logs = readdirSync(dir).filter((n) => n.endsWith(".log"));
    // The name check needs a non-empty effects.log or triggers.log, so an empty file is not usable.
    const usable = ["effects.log", "triggers.log"].some((name) => {
      const stat = statSync(join(dir, name), { throwIfNoEntry: false });
      return stat?.isFile() === true && stat.size > 0;
    });
    if (!usable) return `missing - the maintainer can refresh them with \`node scripts/dump-script-docs.mjs\``;
    // Git keeps no file date, so a date here would show the checkout time. The recorded build lives in
    // docs/wiki/README.md, next to the measurement.
    return `${logs.length} log file(s) in ${DUMP_DIRNAME}/ - exact for the build they were dumped from`;
  } catch {
    return `missing - the maintainer can refresh them with \`node scripts/dump-script-docs.mjs\``;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "get_game_info",
    label: "Get Game Info",
    description:
      "Reports the recorded game environment facts for Crusader Kings III in one call: the game directory, the mod install directory, the Workshop directory, the supported game version, the script layout, whether the vanilla scripts are present, how many Workshop mods the mirror holds, whether the game's dumps are present, and where the entry points are. It takes no arguments, it reads the runtime state only, and it writes nothing.",
    promptSnippet: "Report the game paths, the supported version, the mirror state, and whether the dumps are present",
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

      // The vanilla part of the mirror is a copy of the game directory, so the scripts sit one
      // level down, at `vanilla/game/`. This check reads one directory entry only.
      const vanillaPresent = existsSync(mirrorDirs(cwd).vanillaScripts);

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
        row("", `vanilla:  ${MIRROR_ROOT_DIRNAME}/${MIRROR_DIRNAME}/game/...   (a copy of the game directory)`),
        row("vanilla", vanillaPresent ? "present" : "missing - run sync_game_scripts"),
        row("workshop", workshopRow(cwd)),
        row("dumps", dumpsRow(cwd)),
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
          "NEXT: tell the player to move the mod install directory to an ASCII path (for example relocate the Windows Documents directory), then run try_set_game_dir with no arguments.",
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
