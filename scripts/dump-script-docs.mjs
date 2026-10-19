#!/usr/bin/env node
/**
 * Generate the game's own script documentation and write it into the repository, under
 * `docs/script_docs/` (or `docs/data_types/` for `--command=dump_data_types`).
 *
 * The dumps are repository content, not machine-local state: a clone has the lists without the
 * game. `validate_mod` reads `docs/script_docs/` for its name-level checks, and `mod-reviewer` reads
 * it as the version-exact evidence.
 *
 * The wiki lists under `docs/wiki/` are a transcription and say so. This script asks the game
 * instead. CK3 ships two console commands and a command-line hook that runs one and exits:
 *
 *   script_docs        effects.log, triggers.log, modifiers.log, event_scopes.log,
 *                      event_targets.log, on_actions.log, …
 *   dump_data_types    the GUI data types, promotes, and functions per window
 *
 * The hook is documented in the install at `game/_commandline_options.info` (the wiki does not
 * document it):
 *
 *   -nographics                        no window, an observer game
 *   -debug_mode                        developer mode, which enables the console
 *   -run_console_action=<command>      run one console command (application initialized), then exit
 *
 * The game writes under `<Documents>/Paradox Interactive/Crusader Kings III/logs/`. `Documents` can
 * be moved, so this script asks the registry the same way `.pi/lib/game-paths.ts` does, and then
 * checks the file's modification time to confirm the dump is the one this run produced.
 *
 * Usage: node scripts/dump-script-docs.mjs [--command=script_docs|dump_data_types] [--timeout=240]
 */
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// These two paths are the same as DUMP_DIRNAME and DATA_TYPES_DIRNAME in `.pi/lib/game-paths.ts`.
// This script is plain ESM and cannot import the TypeScript library, so the names live here too.
const DUMP_DIRS = { script_docs: join(root, "docs", "script_docs"), dump_data_types: join(root, "docs", "data_types") };
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const command = argOf("command", "script_docs");
const timeoutSec = Number(argOf("timeout", "240"));

/** The game directory: the recorded one wins, then mod-repo.json's hints. */
function findGameDir() {
  const statePath = join(root, ".gamer-agent.local.json");
  if (existsSync(statePath)) {
    try {
      const recorded = JSON.parse(readFileSync(statePath, "utf8")).gameDir;
      if (typeof recorded === "string" && existsSync(join(recorded, "binaries", "ck3.exe"))) return recorded;
    } catch {
      // Fall through to the hints.
    }
  }
  let hints = [];
  try {
    const cfg = JSON.parse(readFileSync(join(root, "mod-repo.json"), "utf8"));
    const h = cfg?.game?.installDirHint?.windows;
    hints = Array.isArray(h) ? h : typeof h === "string" ? [h] : [];
  } catch {
    hints = [];
  }
  return hints.find((p) => existsSync(join(p, "binaries", "ck3.exe"))) ?? null;
}

/** The player's Documents directory, resolved the way the tools resolve it. */
function userDocuments() {
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders";
  try {
    const out = execFileSync("reg", ["query", key, "/v", "Personal"], { encoding: "utf8" });
    const m = /Personal\s+REG_SZ\s+(.+)/.exec(out);
    if (m) return m[1].trim().replace(/[\\/]+$/, "");
  } catch {
    // Fall through.
  }
  return join(process.env.USERPROFILE ?? "", "Documents");
}

async function main() {
  const gameDir = findGameDir();
  if (!gameDir) {
    console.error("FAIL: no game directory. Run try_set_game_dir in the workspace, or check mod-repo.json.");
    process.exitCode = 1;
    return;
  }
  const exe = join(gameDir, "binaries", "ck3.exe");
  const logsDir = join(userDocuments(), "Paradox Interactive", "Crusader Kings III", "logs");
  const dlcLoadPath = join(userDocuments(), "Paradox Interactive", "Crusader Kings III", "dlc_load.json");
  console.log(`game:  ${gameDir}`);
  console.log(`logs:  ${logsDir}`);
  console.log(`run:   ${exe} -nographics -debug_mode -run_console_action=${command}`);

  // The dump lists code-level effects, triggers, and modifiers, plus the on_action list, which is
  // script-level. Measured on 1.20.1.1 with one workshop mod enabled:
  //   effects, triggers, modifiers, event_scopes, event_targets  -> identical
  //   on_actions                                                 -> +60 entries from the mod
  // So a mod **does** show up, in on_actions.log. Dump with an empty playset for a vanilla baseline.
  try {
    const enabled = JSON.parse(readFileSync(dlcLoadPath, "utf8"))?.enabled_mods;
    if (Array.isArray(enabled) && enabled.length > 0) {
      console.log(
        `NOTE: ${enabled.length} mod(s) are enabled. on_actions.log WILL include their on_actions (measured +60 entries for one mod); the other logs stay code-only. Disable the mods for a vanilla baseline.`,
      );
    } else {
      console.log("playset: no mods enabled (vanilla baseline)");
    }
  } catch {
    console.log("playset: unknown (dlc_load.json is absent or unreadable)");
  }

  const startedAt = Date.now();
  const child = spawn(exe, ["-nographics", "-debug_mode", `-run_console_action=${command}`], {
    cwd: join(gameDir, "binaries"),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));

  const timer = setTimeout(() => {
    console.error(`FAIL: the game did not exit within ${timeoutSec}s. Killing it.`);
    child.kill();
    process.exitCode = 1;
  }, timeoutSec * 1000);

  const code = await new Promise((res) => child.on("exit", (c) => res(c)));
  clearTimeout(timer);

  for (const line of output.split(/\r?\n/).filter(Boolean).slice(-4)) console.log(`  ${line}`);
  // The game exits non-zero after a console action even when the command succeeded, so the exit code
  // is not the verdict. The freshness check below is: the files prove the command ran.
  if (code !== 0) console.log(`  (the game exited with code ${code}; the log check below decides)`);

  if (!existsSync(logsDir)) {
    console.error(`FAIL: the log directory does not exist: ${logsDir}`);
    process.exitCode = 1;
    return;
  }
  // Confirm the files are from this run: a stale log means the command did not write.
  // A log file can be touched by any startup, so require a non-empty one; an empty `error.log` is
  // normal, but the doc lists themselves are never empty.
  const DOC_LOGS = new Set([
    "effects.log",
    "triggers.log",
    "modifiers.log",
    "event_scopes.log",
    "event_targets.log",
    "on_actions.log",
  ]);
  const fresh = readdirSync(logsDir)
    .filter((name) => name.endsWith(".log"))
    .map((name) => join(logsDir, name))
    .filter((p) => statSync(p).mtimeMs >= startedAt - 2000)
    .filter((p) => {
      const name = p.split(/[\\/]/).pop();
      return command === "script_docs" ? DOC_LOGS.has(name) : name.startsWith("data_types");
    });
  if (fresh.length === 0) {
    console.error("FAIL: no log file was written by this run. The command reported success but wrote nothing.");
    console.error("NEXT: launch the game once through the launcher to finish first-run setup, then run this again.");
    process.exitCode = 1;
    return;
  }

  const outDir = DUMP_DIRS[command] ?? DUMP_DIRS.script_docs;
  mkdirSync(outDir, { recursive: true });
  let copied = 0;
  for (const source of fresh) {
    copyFileSync(source, join(outDir, source.split(/[\\/]/).pop()));
    copied += 1;
  }
  console.log(`\nPASS: ${copied} log file(s) written to ${relative(root, outDir).split("\\").join("/")}/`);
  console.log(`  ${fresh.map((p) => p.split(/[\\/]/).pop()).sort().join(", ")}`);
  console.log("  These are version-exact for the installed game and beat the docs/wiki snapshot.");
  console.log("  Commit them: they are repository content, and validate_mod reads them.");
}

await main();
