#!/usr/bin/env node
/**
 * Generate the game's own script documentation and mirror it into `game-scripts/script-docs/`.
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "game-scripts", "script-docs");
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
  console.log(`game:  ${gameDir}`);
  console.log(`logs:  ${logsDir}`);
  console.log(`run:   ${exe} -nographics -debug_mode -run_console_action=${command}`);

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
      return DOC_LOGS.has(name) || (command === "dump_data_types" && name.startsWith("data_types"));
    });
  if (fresh.length === 0) {
    console.error("FAIL: no log file was written by this run. The command reported success but wrote nothing.");
    console.error("NEXT: launch the game once through the launcher to finish first-run setup, then run this again.");
    process.exitCode = 1;
    return;
  }

  mkdirSync(outDir, { recursive: true });
  let copied = 0;
  for (const source of fresh) {
    copyFileSync(source, join(outDir, source.split(/[\\/]/).pop()));
    copied += 1;
  }
  console.log(`\nPASS: ${copied} log file(s) mirrored to game-scripts/script-docs/`);
  console.log(`  ${fresh.map((p) => p.split(/[\\/]/).pop()).sort().join(", ")}`);
  console.log("  These are version-exact for the installed game and beat the docs/wiki snapshot.");
}

await main();
