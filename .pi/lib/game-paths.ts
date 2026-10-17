/**
 * The shared implementation of the path checks and the runtime state. It is a CK3 game repo
 * library, and it is not a tool.
 *
 * It lives in `.pi/lib/` because pi loads `.pi/extensions/*.ts` and the index.ts in each
 * subdirectory of `.pi/extensions/`. A shared module in that directory is loaded as an extension.
 * Each tool imports this file by relative path.
 *
 * How CK3 differs from Duckov, and why the checks differ:
 *   - gameDir        The directory must hold the executable `binaries/ck3.exe`, which is the CK3
 *                    install layout. Windows only.
 *   - workshopDir    The directory `<SteamLibrary>/steamapps/workshop/content/<appid>`.
 *   - modInstallDir  The Paradox launcher directory, which is independent of the game location:
 *                    `<the player's Documents directory>/Paradox Interactive/Crusader Kings III/mod`.
 *                    There is no sibling-directory sentinel to check. The tool therefore
 *                    checks the shape: an absolute path, not a file, and the relative path that
 *                    mod-repo.json declares at the end. The player can move the Documents
 *                    directory, and it is then not `<home>/Documents`, so the tool reads the real
 *                    directory from the registry. See userDocumentsDir.
 *   - The search     The tool must scan Steam: the registry and libraryfolders.vdf in each
 *                    library. It does not use installDirHint.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, isAbsolute, join, resolve } from "node:path";
import os from "node:os";

/** The game directory sentinel: the executable `binaries/ck3.exe`. Duckov uses `TeamSoda.Duckov.Core.dll` in the same way. */
export const GAME_SENTINEL = join("binaries", "ck3.exe");

export interface ModRepoConfig {
  game?: { name?: string; steamAppId?: string | number; installDirHint?: Record<string, string> };
  modInstall?: { path?: string; relativeTo?: string };
  /** Whether this game has a Workshop. A missing field means unknown, and it does not mean false. */
  workshop?: { supported?: boolean };
}

/**
 * The Workshop declaration from the contract: `true`, `false`, or `null` for undeclared, which means
 * unknown.
 * This repository keeps one copy of the check, so a consumer must not read `cfg.workshop` again.
 */
export function workshopSupported(cfg: ModRepoConfig): boolean | null {
  const value = cfg.workshop?.supported;
  return typeof value === "boolean" ? value : null;
}

export interface RuntimeState {
  gameDir?: string | null;
  /**
   * The build tag of the recorded game, for example `1.20.1.1`. It is a cache of the tag that
   * `<gameDir>/binaries/ck3.exe` holds, so it belongs to the recorded gameDir: try_set_game_dir
   * clears the field when a different gameDir replaces the recorded one. A missing field and `null`
   * both mean that no tag is known, and `gameBuildTried` then says whether the tool already read the
   * executable for this gameDir. The field is the version source for supportedGameVersion, and the
   * tools never print it.
   */
  gameBuild?: string | null;
  /**
   * Whether try_set_game_dir already read `<gameDir>/binaries/ck3.exe` for the recorded gameDir.
   * It is the sentinel for a game whose executable holds no build tag. Without it, every call would
   * read the whole executable again (237 ms on the test machine, and the limit is 30 s). A missing
   * field and `false` both mean that no read has happened yet. A new gameDir clears the field, so
   * the next call reads the new executable.
   */
  gameBuildTried?: boolean;
  workshopDir?: string | null;
  modInstallDir?: string | null;
  [key: string]: unknown;
}

export interface PathVerdict {
  ok: boolean;
  path: string | null;
  /** The machine-readable code on failure. The tool puts it in the first line of the FAIL text. */
  code?: string;
  reason?: string;
  /** The next step for the agent. It is actionable, and the player can read it. */
  next?: string;
  /**
   * A problem that does not fail the check, but that the caller must report as a WARN. It is set only
   * when ok is true. A read-only check sets it; a check that gates a write does not.
   */
  warning?: string;
  /** The next step for the agent, for the warning. */
  warningNext?: string;
}

export const platformKey = (): string =>
  process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";

export const statePath = (cwd: string): string => join(cwd, ".gamer-agent.local.json");

export function readModRepoConfig(cwd: string): ModRepoConfig {
  return JSON.parse(readFileSync(join(cwd, "mod-repo.json"), "utf8")) as ModRepoConfig;
}

export function readState(cwd: string): RuntimeState {
  try {
    return JSON.parse(readFileSync(statePath(cwd), "utf8")) as RuntimeState;
  } catch {
    return {};
  }
}

/**
 * Reads, changes, and writes, with an atomic replace: a temporary file, then rename. Every writer
 * goes through this function.
 */
export function writeState(cwd: string, patch: RuntimeState): RuntimeState {
  const next = { ...readState(cwd), ...patch };
  const file = statePath(cwd);
  const tmp = `${file}.tmp-${process.pid}`;
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, file);
  return next;
}

/** Expands `~` and `~/...`. An older `.gamer-agent.local.json` or a hint can hold them, and the tool can never check an unexpanded path. */export const expandHome = (p: string): string => {
  const t = p.trim();
  if (t !== "~" && !t.startsWith("~/")) return t;
  return join(os.homedir(), t.slice(2));
};

export const resolveUserPath = (cwd: string, p: string): string => resolve(cwd, expandHome(p));

/** Reads the `Personal` value under a registry key. The value line is `    Personal    REG_SZ    <path>`. */
const readPersonalValue = (key: string): string | null => {
  try {
    const out = execFileSync("reg", ["query", key, "/v", "Personal"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    const line = out.match(/^\s*Personal\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/m);
    return line ? line[1] : null;
  } catch {
    // The key can be missing, and reg.exe can be unavailable. Both cases mean the same: no answer.
    return null;
  }
};

/** Expands `%NAME%`. `User Shell Folders` holds a path such as `%USERPROFILE%\Documents` on some machines. */
const expandWindowsVars = (p: string): string | null => {
  const out = p.replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? process.env[name.toUpperCase()] ?? "");
  return out.includes("%") ? null : out;
};

const resolveUserDocumentsDir = (): string => {
  const home = os.homedir();
  if (process.platform !== "win32") return join(home, "Documents");
  // `Shell Folders` holds the resolved path. `User Shell Folders` can hold `%USERPROFILE%`, so it
  // is the second choice. Read both, because a machine can hold only one of them.
  const roots = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
  ];
  for (const key of roots) {
    const raw = readPersonalValue(key);
    if (!raw) continue;
    const expanded = expandWindowsVars(raw);
    if (!expanded) continue;
    const p = expanded.replace(/[\\/]+$/, "");
    if (p) return p;
  }
  // A machine that never moved the directory, or an unreadable registry. Both give the same answer.
  return join(process.env.USERPROFILE || home, "Documents");
};

let documentsDir: string | null = null;

/**
 * The player's Documents directory. Windows lets the player move it, and `os.homedir()` does not
 * follow the move. The tool therefore reads the known folder from the registry and caches the
 * answer for the process.
 */
export const userDocumentsDir = (): string => (documentsDir ??= resolveUserDocumentsDir());

/**
 * The Paradox launcher mod directory. `modInstall.relativeTo` selects the base directory: the
 * player's Documents directory, or the game directory. mod-repo.json declares `path` relative to
 * that base. A missing `relativeTo` means `userDocuments`.
 */
export function modInstallDirFor(cfg: ModRepoConfig, gameDir?: string | null): string | null {
  const rel = cfg.modInstall?.path;
  if (typeof rel !== "string" || !rel.trim()) return null;
  if (cfg.modInstall?.relativeTo === "gameDir") return gameDir ? join(expandHome(gameDir), rel) : null;
  return join(userDocumentsDir(), rel);
}

/** Two paths name the same directory. Windows paths are case-insensitive and can mix the separators. */
const sameDir = (a: string, b: string): boolean => {
  const norm = (v: string) => v.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
};

/**
 * The mod install directory the tools must use. The recorded value is a cache, and the player can
 * move the Documents directory after the tool recorded it. The derived value therefore wins when
 * the two differ, and `corrected` tells the caller to repair the state.
 */
export function effectiveModInstallDir(
  cwd: string,
  cfg: ModRepoConfig | null,
): { dir: string | null; recorded: string | null; derived: string | null; corrected: boolean } {
  const state = readState(cwd);
  const recorded = typeof state.modInstallDir === "string" && state.modInstallDir.trim() ? state.modInstallDir.trim() : null;
  const gameDir = typeof state.gameDir === "string" && state.gameDir.trim() ? state.gameDir.trim() : null;
  // A missing or unreadable mod-repo.json leaves the recorded path as the only source, which is
  // what the caller must report when it is absent too.
  const derived = cfg ? modInstallDirFor(cfg, gameDir) : null;
  if (!derived) return { dir: recorded, recorded, derived, corrected: false };
  if (recorded && sameDir(recorded, derived)) return { dir: recorded, recorded, derived, corrected: false };
  return { dir: derived, recorded, derived, corrected: recorded !== null };
}

const NEXT_SKILL =
  "The 'setup-workspace' skill has the full procedure: the automatic search, the player's hints, and what to ask when nothing works.";

/**
 * Turns the recorded build tag into the version value for the mod metadata: `1.20.1` becomes
 * `1.20.*`. It returns null when no tag is recorded, and it never returns the exact build.
 *
 * One copy of the rule lives here, because two callers need it: get_game_info reports the value, and
 * install_mod writes it into the `<name>.mod` pointer file when the descriptor omits it.
 */
export function supportedGameVersion(build: string | null | undefined): string | null {
  if (typeof build !== "string") return null;
  const m = build.trim().match(/^(\d+)\.(\d+)\./);
  return m ? `${m[1]}.${m[2]}.*` : null;
}

/**
 * The distinct non-ASCII characters in a path, in order of first appearance. Empty means ASCII only.
 *
 * Engine rule: the game reads a mod at a path with a non-ASCII character as having no files inside.
 * A Windows user profile whose name is not ASCII is the usual cause, because the Paradox mod folder
 * sits under Documents. One copy of this rule lives here, so check_game_paths and install_mod cannot
 * disagree.
 */
export function nonAsciiCharsInPath(p: string): string[] {
  const seen = new Set<string>();
  for (const ch of p) {
    const code = ch.codePointAt(0);
    if (code !== undefined && code > 0x7f) seen.add(ch);
  }
  return [...seen];
}

/** Check 1: is this directory the CK3 install directory. The check reads the main executable, binaries/ck3.exe. */
export function checkGameDir(dir: string | null | undefined): PathVerdict {
  const p = dir ? expandHome(dir) : null;
  if (!p)
    return { ok: false, path: null, code: "GAME_DIRECTORY_NOT_FOUND", reason: "no game directory was given", next: `Run try_set_game_dir with no arguments to locate the game and record it, together with the derived paths. You can also check candidates from the player's hints with check_game_paths. ${NEXT_SKILL}` };
  if (!existsSync(join(p, GAME_SENTINEL)))
    return {
      ok: false,
      path: p,
      code: "GAME_DIRECTORY_NOT_FOUND",
      reason: `binaries/ck3.exe does not exist under this directory (not a CK3 install directory)`,
      next: `Run try_set_game_dir with no arguments to locate the real game directory again. The path you passed does not look like one, because it has no binaries/ck3.exe. ${NEXT_SKILL}`,
    };
  return { ok: true, path: p };
}

/** Check 2: the mod install target. It is the fixed Paradox location, checked by shape, because there is no sentinel to read. */
/**
 * How a caller treats a non-ASCII mod install path.
 *   - "error" (default): reject it. A caller that creates the directory uses this: a directory we
 *     create ourselves must be ASCII.
 *   - "warn": pass it, and report a warning. A read-only check uses this, because the path may be
 *     the player's own Documents folder, and the check must not turn into a failure.
 */
export type AsciiPathMode = "error" | "warn";

export interface ModInstallDirOptions {
  ascii?: AsciiPathMode;
}

export function checkModInstallDir(
  dir: string | null | undefined,
  cfg?: ModRepoConfig,
  opts?: ModInstallDirOptions,
): PathVerdict {
  const p = dir ? expandHome(dir) : null;
  if (!p)
    return { ok: false, path: null, code: "TARGET_NOT_FOUND", reason: "no mod install directory was given", next: `Run try_set_game_dir with no arguments. It records the game directory and the derived mod install directory. ${NEXT_SKILL}` };
  if (!isAbsolute(p))
    return { ok: false, path: p, code: "TARGET_INVALID", reason: "not an absolute path", next: `Run try_set_game_dir with no arguments to record the conventional mod install directory. ${NEXT_SKILL}` };
  // The engine rule: a non-ASCII character anywhere in the path of the mod folder makes the game
  // read the mod as having no files inside. This happens with a Windows user profile whose name is
  // not ASCII, because the mod folder sits under Documents. Nothing in the mod can repair it.
  // The severity depends on the caller, not on the path: a caller that creates the directory must
  // refuse it, and a read-only check only warns.
  const badChars = nonAsciiCharsInPath(p);
  const asciiWarning =
    badChars.length > 0
      ? {
          code: "TARGET_NOT_ASCII",
          warning: `the path has non-ASCII character(s) ${badChars.map((c) => `'${c}'`).join(", ")}, and the game reads a mod at such a path as having no files inside`,
          warningNext: `The player must move the mod install directory to a path that is pure ASCII, for example by relocating the Windows Documents folder, or by pointing the Paradox mod directory at an ASCII path. Then run try_set_game_dir with no arguments to record it. Do not rename or edit the mod: the character is in the path, not in the mod content. ${NEXT_SKILL}`,
        }
      : null;
  if (asciiWarning && (opts?.ascii ?? "error") === "error")
    return {
      ok: false,
      path: p,
      code: asciiWarning.code,
      reason: asciiWarning.warning,
      next: asciiWarning.warningNext,
    };
  // The check passes with a warning. Every ok return below carries it.
  const pass = (): PathVerdict =>
    asciiWarning
      ? { ok: true, path: p, code: asciiWarning.code, warning: asciiWarning.warning, warningNext: asciiWarning.warningNext }
      : { ok: true, path: p };
  // Run the checks that do not need the configuration first. The order matters, because these must
  // still run when the shape check is skipped.
  const st = statSync(p, { throwIfNoEntry: false });
  if (st && !st.isDirectory())
    return { ok: false, path: p, code: "TARGET_INVALID", reason: "this path exists but is not a directory (it is a file)", next: `Ask the player to delete or rename the file blocking that path. ${NEXT_SKILL}` };
  const rel = cfg?.modInstall?.path;
  // The shape check is our opinion about the Paradox directory convention, and it is not a hard game
  // rule. Skip it when the configuration is unreadable or has no modInstall.path, because
  // try_set_game_dir reports a missing field.
  if (typeof rel !== "string" || !rel.trim()) return pass();
  const norm = (v: string) => v.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (!norm(p).endsWith(norm(rel)))
    return {
      ok: false,
      path: p,
      code: "TARGET_INVALID",
      reason: `the path does not end with ${rel} as declared in mod-repo.json (the Paradox launcher only looks there)`,
      next: `Run try_set_game_dir with no arguments to record the conventional mod install directory. ${NEXT_SKILL}`,
    };
  // A missing directory is the normal state on a new machine, and the install creates it.
  return pass();
}

/** Check 3: the Steam Workshop directory. It is a read-only reference, and it must be `.../steamapps/workshop/content/<appId>`. */
export function checkWorkshopDir(dir: string | null | undefined, appId: string): PathVerdict {
  const p = dir ? expandHome(dir) : null;
  if (!p) return { ok: false, path: null, code: "WORKSHOP_NOT_FOUND", reason: "no Workshop directory was given (optional)", next: "Omit it. It is only used to read Workshop content for reference." };
  if (!existsSync(p)) return { ok: false, path: p, code: "WORKSHOP_NOT_FOUND", reason: "the directory does not exist", next: "Omit this argument, because the Workshop directory is an optional read-only reference." };
  // The shape check normalizes the separators, the trailing separators, and the letter case before
  // it compares. Windows paths ignore case, and a Steam library path can differ in case from the
  // usual spelling, so one letter must not fail the check.
  // When the appid is unknown, because mod-repo.json is unreadable, the tool checks existence only.
  // The shape check is meaningful only when the rule is known.
  const norm = (v: string) => v.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (appId && !norm(p).endsWith(norm(`/workshop/content/${appId}`)))
    return { ok: false, path: p, code: "WORKSHOP_NOT_FOUND", reason: `the path does not end with workshop/content/${appId} (see the appid in mod-repo.json)`, next: "Use this path only if it is the Workshop content directory for this game. Omit it if you are not sure." };
  return { ok: true, path: p };
}

// The search. CK3 reads the registry and libraryfolders.vdf in each Steam library. Windows only.

function readRegistrySteamPath(): string | null {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function parseLibraryFolders(steamPath: string): string[] {
  try {
    const text = readFileSync(join(steamPath, "steamapps", "libraryfolders.vdf"), "utf8");
    const roots: string[] = [];
    const re = /"path"\s+"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) roots.push(m[1].replace(/\\\\/g, "\\"));
    return roots;
  } catch {
    return [];
  }
}

function discoverSteamLibraryRoots(): string[] {
  const roots: string[] = [];
  const steamPath = readRegistrySteamPath();
  if (steamPath) {
    roots.push(steamPath);
    roots.push(...parseLibraryFolders(steamPath));
  }
  for (const p of ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"]) {
    if (!roots.includes(p)) roots.push(p);
  }
  return roots;
}

export const GAME_FOLDER_NAME = "Crusader Kings III";

/** The candidate game directories: an explicit path, the state, the platform hint when present, then steamapps/common/<game name> in each Steam library. */
export function gameDirCandidates(cfg: ModRepoConfig, state: RuntimeState, explicit?: string): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push(expandHome(v));
  };
  if (explicit?.trim()) push(explicit);
  push(state.gameDir);
  push(cfg.game?.installDirHint?.windows); // CK3 is Windows only, so the hint has a windows key only.
  if (process.platform === "win32") {
    for (const root of discoverSteamLibraryRoots()) out.push(join(root, "steamapps", "common", GAME_FOLDER_NAME));
  }
  return [...new Set(out)];
}

/** Checks the candidates in order and returns the first one that passes. A candidate is a candidate, so every one must pass checkGameDir. */
export function discoverGameDir(
  cfg: ModRepoConfig,
  state: RuntimeState,
  explicit?: string,
): { gameDir: string | null; tried: Array<{ path: string; reason?: string }>; platformUnsupported: boolean } {
  const tried: Array<{ path: string; reason?: string }> = [];
  const platformUnsupported = process.platform !== "win32";
  if (platformUnsupported) {
    // CK3 cannot be located on a platform other than Windows. Say that, and do not pretend to succeed.
    return { gameDir: null, tried, platformUnsupported };
  }
  for (const c of gameDirCandidates(cfg, state, explicit)) {
    const v = checkGameDir(c);
    if (v.ok) return { gameDir: v.path ?? c, tried, platformUnsupported };
    tried.push({ path: c, reason: v.reason });
  }
  return { gameDir: null, tried, platformUnsupported };
}

/** The Workshop directory, in the same library as gameDir or in any library. */
export function workshopDirFor(gameDir: string, cfg: ModRepoConfig): string | null {
  const appId = String(cfg.game?.steamAppId ?? "");
  if (!appId || !gameDir) return null;
  let p = gameDir;
  while (p && p !== resolve(p, "..") && !existsSync(join(p, "steamapps"))) p = resolve(p, "..");
  if (!p) return null;
  const candidate = join(p, "steamapps", "workshop", "content", appId);
  return existsSync(candidate) ? candidate : null;
}

/** Derives the other paths from a game directory that passed the check. The Workshop directory is a read-only reference, so the tool does not record it when it does not exist. */
export function pathsFor(
  gameDir: string,
  cfg: ModRepoConfig,
): { modInstallDir: string | null; workshopDir: string | null; notes: string[] } {
  const notes: string[] = [];
  const modInstallDir = modInstallDirFor(cfg, gameDir);
  if (!modInstallDir) notes.push("FAIL: INVALID_WORKSPACE_CONFIG: mod-repo.json has no modInstall.path");
  const workshopDir = workshopDirFor(gameDir, cfg);
  if (!workshopDir && cfg.game?.steamAppId) notes.push("NOTE: the Workshop directory does not exist, so it was not recorded (optional, read-only reference).");
  return { modInstallDir, workshopDir, notes };
}

// The build tag. It is the only true version source for the game, and the tool reads it once.
// The pattern anchors the `/release/` prefix, because the executable also holds dependency version
// strings, and zlib `1.2.11` is one of them. `VersionInfo` is not a source: it says `1.0`.
// The lookahead rejects a match that a further digit follows, so a window that ends in `1.20.1` of
// `1.20.1.1` does not match.
const BUILD_TAG_RE = /[a-zA-Z0-9_]+\/release\/(\d+\.\d+\.\d+)(?![0-9])/;
const BUILD_TAG_TIMEOUT_MS = 30_000;
/** The overlap between two chunks. A tag that starts in one chunk and ends in the next must still match. */
const BUILD_TAG_OVERLAP = 64;

/**
 * Reads the game build tag from `<gameDir>/binaries/ck3.exe`, for example `1.20.1.1`.
 * It reads the file in chunks, because the executable is larger than 100 MB, and it stops at the
 * 30-second limit. It returns `null` when the file is missing, unreadable, holds no tag, or does not
 * finish in time. It does not guess.
 */
export async function readGameBuildTag(gameDir: string): Promise<string | null> {
  if (typeof gameDir !== "string" || !gameDir.trim()) return null;
  try {
    const stream = createReadStream(join(gameDir, GAME_SENTINEL), {
      encoding: "latin1",
      signal: AbortSignal.timeout(BUILD_TAG_TIMEOUT_MS),
    });
    let tail = "";
    for await (const chunk of stream) {
      const text = tail + (chunk as string);
      const m = text.match(BUILD_TAG_RE);
      // A match that ends at the window end can be cut: the next byte can be a digit, so the
      // match is not the full tag. Keep the window and match again with the next chunk.
      if (m && (m.index ?? 0) + m[0].length < text.length) return m[1];
      tail = text.slice(-BUILD_TAG_OVERLAP);
    }
    // The stream ended. Here a match at the tail end is complete, because no byte follows it.
    const last = tail.match(BUILD_TAG_RE);
    return last ? last[1] : null;
  } catch {
    return null;
  }
}

/** The fallback for a file name, with the basename behavior that the other tools share. */
export const baseName = (p: string): string => basename(p);

// The internal implementation of the agent entry points. These are not registered as tools.
// Semantics:
//   1. A path is given, it passes the check, and the tool records it (PASS).
//   2. It fails the check, and the internal search or derivation succeeds. The tool records that
//      path with WARN.
//   3. The internal step also fails, so the tool returns FAIL and records nothing.
export type PathKind = "gameDir" | "workshopDir" | "modInstallDir";

export interface PathOutcome {
  kind: PathKind;
  status: "PASS" | "WARN" | "FAIL";
  given: string | null;
  recorded: string | null;
  reason?: string;
  next?: string;
}

const ASK_PLAYER =
  "The automatic search failed as well. Ask the player for the correct path, and say what you already tried. Then call this setter again with that path. The 'setup-workspace' skill has what to ask for.";

function verifyPath(kind: PathKind, p: string, cfg: ModRepoConfig, appId: string): PathVerdict {
  if (kind === "gameDir") return checkGameDir(p);
  if (kind === "workshopDir") return checkWorkshopDir(p, appId);
  return checkModInstallDir(p, cfg);
}

function deriveFallback(cwd: string, cfg: ModRepoConfig, kind: PathKind): { ok: boolean; path?: string; note?: string; reason?: string } {
  const state = readState(cwd);
  const remembered = checkGameDir(typeof state.gameDir === "string" ? state.gameDir : null);
  let gameDir: string | null = remembered.ok ? (remembered.path as string) : null;
  if (!gameDir) {
    const found = discoverGameDir(cfg, state);
    if (found.platformUnsupported)
      return { ok: false, reason: `${GAME_FOLDER_NAME} is only supported on Windows by this repository, so nothing can be located on this platform` };
    gameDir = found.gameDir;
  }
  if (!gameDir) return { ok: false, reason: "the automatic search could not find the game either" };
  if (kind === "gameDir") return { ok: true, path: gameDir };
  const derived = pathsFor(gameDir, cfg);
  const path = kind === "workshopDir" ? derived.workshopDir : derived.modInstallDir;
  if (!path) return { ok: false, reason: `${kind} cannot be derived from the game directory` };
  return { ok: true, path, note: derived.notes.join(" ") };
}

/**
 * Compares a recorded path with a new one. Windows paths ignore the letter case and the separator
 * style, so another spelling of the same directory must not count as a different directory.
 */
function samePath(recorded: unknown, path: string): boolean {
  if (typeof recorded !== "string" || !recorded.trim()) return false;
  const norm = (v: string) => v.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(recorded) === norm(path);
}

/**
 * Writes the recorded paths. `gameBuild` has two meanings, and the caller must choose:
 *   - `undefined` leaves the cached field alone, because set_game_dir records only its given path;
 *   - `null` is a real cached value, and it means that the tool read the executable and found no tag.
 * The cached tag belongs to the recorded gameDir, so a new gameDir invalidates it: the field becomes
 * `null`, and `gameBuildTried` becomes `false`, so the next try_set_game_dir reads the new
 * executable. A repeat of the same path keeps the tag, so set_game_dir stays idempotent.
 */
function record(cwd: string, cfg: ModRepoConfig, kind: PathKind, path: string, gameBuild?: string | null): void {
  if (kind === "gameDir") {
    const d = pathsFor(path, cfg);
    const patch: RuntimeState = { gameDir: path, modInstallDir: d.modInstallDir, workshopDir: d.workshopDir ?? null };
    if (gameBuild !== undefined) {
      // The caller read the executable, so the sentinel marks that read.
      patch.gameBuild = gameBuild;
      patch.gameBuildTried = true;
    } else if (!samePath(readState(cwd).gameDir, path)) {
      // A new gameDir replaces the recorded one, so the cached tag is stale and no read has
      // happened for the new executable yet.
      patch.gameBuild = null;
      patch.gameBuildTried = false;
    }
    writeState(cwd, patch);
    return;
  }
  writeState(cwd, kind === "modInstallDir" ? { modInstallDir: path } : { workshopDir: path });
}

export function setPathWithFallback(cwd: string, cfg: ModRepoConfig, kind: PathKind, givenRaw: string | null): PathOutcome {
  const appId = String(cfg.game?.steamAppId ?? "");
  const given = givenRaw && givenRaw.trim() ? expandHome(givenRaw) : null;
  if (!given)
    return { kind, status: "FAIL", given: null, recorded: null, reason: "no path was given", next: "Pass the path the player provided (this setter requires it)." };

  const v = verifyPath(kind, given, cfg, appId);
  if (v.ok) {
    record(cwd, cfg, kind, given);
    return { kind, status: "PASS", given, recorded: given };
  }

  const fallback = deriveFallback(cwd, cfg, kind);
  if (fallback.ok && fallback.path) {
    record(cwd, cfg, kind, fallback.path);
    return {
      kind,
      status: "WARN",
      given,
      recorded: fallback.path,
      reason: v.reason,
      next: `Your path did not pass the check, so the tool located and recorded ${fallback.path} instead.${fallback.note ? ` ${fallback.note}` : ""} Tell the player which path is in use.`,
    };
  }

  return {
    kind,
    status: "FAIL",
    given,
    recorded: null,
    reason: `${v.reason} (${fallback.reason ?? "and it could not be derived either"})`,
    next: ASK_PLAYER,
  };
}

/** The output format for the path setters. */
export function formatPathOutcome(o: PathOutcome): { text: string; ok: boolean; status: PathOutcome["status"] } {
  if (o.status === "PASS")
    return { text: `PASS: recorded ${o.kind} ${o.recorded} (correct).`, ok: true, status: o.status };
  if (o.status === "WARN")
    return {
      text:
        `WARN: the ${o.kind} you passed (${o.given}) did not pass the check - ${o.reason}.\n` +
        `The tool recorded ${o.recorded} instead.\nNEXT: ${o.next ?? "Tell the player which path is in use."}`,
      ok: true,
      status: o.status,
    };
  return {
    text: `FAIL: could not record ${o.kind}.\nGiven: ${o.given ?? "(not given)"}\nReason: ${o.reason ?? "unknown"}.\nNEXT: ${o.next ?? ASK_PLAYER}`,
    ok: false,
    status: o.status,
  };
}

// The internal implementation of try_set_game_dir. It is not registered as a tool.
// Semantics, with no arguments and idempotent:
//   1. The remembered gameDir is still valid, and the two derived paths match the recorded ones.
//      The tool returns already, with the cached gameBuild from the state. It reads the executable
//      only when the cached tag is `null` and no read has happened yet for this gameDir, and it
//      writes the tag and the `gameBuildTried` sentinel back then.
//   2. The path is invalid, stale, or never recorded. The tool searches, and every candidate must
//      pass the sentinel. It reads the build tag once, records gameDir, gameBuild, `gameBuildTried`,
//      and the two derived paths, and returns recorded.
//   3. It finds nothing, writes no state, and returns missing.
// CK3 facts: Windows only. modInstallDir is the Paradox launcher directory, which is independent of
// gameDir and always computed from modInstall.path in mod-repo.json. The tool derives workshopDir
// from gameDir, and the tools treat it as a read-only reference.

export type EnsureOutcome =
  | { status: "already"; gameDir: string; gameBuild: string | null; modInstallDir: string | null; workshopDir: string | null; warnings: string[]; wroteState: boolean }
  | { status: "recorded"; gameDir: string; gameBuild: string | null; modInstallDir: string | null; workshopDir: string | null; warnings: string[]; wroteState: boolean }
  | { status: "missing"; reason: string };

/** The cached build tag. A missing field and a non-string value both mean that no tag is known. */
const cachedGameBuild = (state: RuntimeState): string | null =>
  typeof state.gameBuild === "string" ? state.gameBuild : null;

function derivedWarnings(modInstallDir: string | null, workshopDir: string | null): string[] {
  const out: string[] = [];
  if (modInstallDir && !existsSync(modInstallDir)) {
    out.push("the mod install directory does not exist yet - normal on a first install (install_mod creates it).");
  }
  if (!modInstallDir) {
    out.push("mod-repo.json declares no modInstall.path.");
  }
  if (!workshopDir) {
    out.push("no Steam Workshop directory was found. It is optional, and the tools only read it.");
  }
  return out;
}

/**
 * Ensures that the game directory is recorded and valid. The tool reads the build tag at the first
 * record, and it returns the cached value afterwards. One exception: a cached `null` tag is no tag,
 * so the tool reads the executable once when no read has happened yet for this gameDir. It writes
 * the result and the `gameBuildTried` sentinel back, so it reads the executable one time in total,
 * even for a game whose executable holds no tag.
 */
export async function ensureGameDir(cwd: string, cfg: ModRepoConfig): Promise<EnsureOutcome> {
  const state = readState(cwd);
  const remembered = checkGameDir(typeof state.gameDir === "string" ? state.gameDir : null);
  if (remembered.ok) {
    const d = pathsFor(remembered.path as string, cfg);
    const same =
      (state.modInstallDir ?? null) === (d.modInstallDir ?? null) &&
      (state.workshopDir ?? null) === (d.workshopDir ?? null);
    if (same) {
      // The cached value comes from the state. A `null` tag means unknown, because an earlier
      // record found no tag or a new gameDir cleared it. Read the executable once then, and write
      // the tag back with the sentinel, so get_game_info reports a version instead of "unknown" for
      // ever. The sentinel also stops a second read, because a game whose executable holds no tag
      // would otherwise pay a full read on every call (237 ms on the test machine, and the limit is
      // 30 s).
      let gameBuild = cachedGameBuild(state);
      let wroteState = false;
      if (gameBuild === null && state.gameBuildTried !== true) {
        gameBuild = await readGameBuildTag(remembered.path as string);
        writeState(cwd, { gameBuild, gameBuildTried: true });
        wroteState = true;
      }
      return {
        status: "already",
        gameDir: remembered.path as string,
        gameBuild,
        modInstallDir: d.modInstallDir,
        workshopDir: d.workshopDir,
        warnings: derivedWarnings(d.modInstallDir, d.workshopDir),
        wroteState,
      };
    }
  }
  const { gameDir, platformUnsupported } = discoverGameDir(cfg, state);
  if (!gameDir) {
    return {
      status: "missing",
      reason: platformUnsupported
        ? `${GAME_FOLDER_NAME} is only supported on Windows by this repository, so no game files can be located on this platform`
        : "the automatic search did not find the game (the tool searched the registry and every Steam library)",
    };
  }
  // The first record: read the build tag once and cache it. An already recorded gameDir returned
  // above, so this is the only place that reads the executable. A `null` result is stored as null,
  // and `record` sets the `gameBuildTried` sentinel with it.
  const gameBuild = await readGameBuildTag(gameDir);
  record(cwd, cfg, "gameDir", gameDir, gameBuild);
  const d = pathsFor(gameDir, cfg);
  return {
    status: "recorded",
    gameDir,
    gameBuild,
    modInstallDir: d.modInstallDir,
    workshopDir: d.workshopDir,
    warnings: derivedWarnings(d.modInstallDir, d.workshopDir),
    wroteState: true,
  };
}
