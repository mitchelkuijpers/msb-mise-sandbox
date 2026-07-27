/**
 * Idempotent symlink install into ~/.local/bin.
 *
 * The wrapper's `install` command creates (or replaces with --force) a
 * symlink at ~/.local/bin/mise-msb pointing to the repository's
 * executable launcher. It never edits shell startup files.
 */

import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface InstallOptions {
  /** Override target directory (default ~/.local/bin). */
  binDir?: string;
  /** Override HOME for tests. */
  homeDir?: string;
  /** Override source launcher path (default <repo>/bin/mise-msb). */
  sourcePath?: string;
  /** Force replacement when destination points elsewhere. */
  force?: boolean;
}

export interface InstallResult {
  /** Final state of the destination. */
  status: "created" | "unchanged" | "replaced" | "refused";
  /** The destination path (~/.local/bin/mise-msb). */
  destination: string;
  /** The path the symlink resolves to (when status != refused). */
  target?: string;
  /** When status is refused, the existing target. */
  existingTarget?: string;
  /** True if a PATH warning should be printed after the action. */
  pathWarning: boolean;
}

const DEFAULT_BIN_DIR = join(".local", "bin");
const LINK_NAME = "mise-msb";

export function defaultBinDir(home: string = homedir()): string {
  return join(home, DEFAULT_BIN_DIR);
}

/**
 * Idempotent install of the wrapper. When the destination already points
 * at the same source, returns status "unchanged" without touching the
 * filesystem.
 */
export function installWrapper(options: InstallOptions = {}): InstallResult {
  const home = options.homeDir ?? homedir();
  const binDir = options.binDir ?? defaultBinDir(home);
  const destination = join(binDir, LINK_NAME);
  const sourcePath = options.sourcePath ?? defaultSourcePath();
  const pathWarning = !pathContains(binDir);

  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }

  // Case 1: destination doesn't exist — create it.
  if (!existsSync(destination)) {
    symlinkSync(sourcePath, destination);
    return { status: "created", destination, target: sourcePath, pathWarning };
  }

  // Case 2: destination exists — inspect its type.
  const stat = lstatSync(destination);
  if (stat.isDirectory()) {
    // Refuse to recursively remove a directory.
    return {
      status: "refused",
      destination,
      existingTarget: destination,
      pathWarning,
    };
  }

  // Case 3: destination is a symlink.
  if (stat.isSymbolicLink()) {
    const existingTarget = safeReadlink(destination);
    if (existingTarget === sourcePath) {
      return {
        status: "unchanged",
        destination,
        target: sourcePath,
        pathWarning,
      };
    }
    if (options.force !== true) {
      return {
        status: "refused",
        destination,
        existingTarget,
        pathWarning,
      };
    }
    unlinkSync(destination);
    symlinkSync(sourcePath, destination);
    return { status: "replaced", destination, target: sourcePath, pathWarning };
  }

  // Case 4: regular file (or anything else) — require --force to replace.
  if (options.force !== true) {
    return {
      status: "refused",
      destination,
      existingTarget: destination,
      pathWarning,
    };
  }
  unlinkSync(destination);
  symlinkSync(sourcePath, destination);
  return { status: "replaced", destination, target: sourcePath, pathWarning };
}

function safeReadlink(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    return path;
  }
}

/** Resolve the repository's launcher path. Used when --source is omitted. */
function defaultSourcePath(): string {
  // The launcher lives at <repo>/bin/mise-msb. We compute the repo root
  // from the source location: src/install/symlink.ts → ../../bin/mise-msb
  // (this file). We import.meta.resolve to get the current URL and derive
  // the path from there. When running under tests, callers should pass
  // an explicit sourcePath.
  //
  // For now, fall back to the conventional path under cwd.
  return join(process.cwd(), "bin", "mise-msb");
}

/** Whether the given directory appears in $PATH. */
export function pathContains(dir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const pathEnv = env["PATH"];
  if (pathEnv === undefined) return false;
  return pathEnv.split(":").includes(dir);
}

/** Print the PATH warning hint for users whose shell hasn't been updated. */
export function pathWarningMessage(binDir: string): string {
  const home = homedir();
  const display = binDir.startsWith(home) ? `~${binDir.slice(home.length)}` : binDir;
  return `mise-msb: ${display} is not on $PATH — add it with:\n` +
    `    export PATH="${binDir}:$PATH"`;
}
