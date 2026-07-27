/**
 * Subprocess helpers for the wrapper.
 *
 * All external commands run via these helpers. We never invoke a shell —
 * argv arrays are passed directly to Bun.spawn so values are immune to
 * shell metacharacters and injection.
 */

import { existsSync, statSync } from "node:fs";

export interface SpawnOptions {
  /** Inherit stdin/stdout/stderr (default true). */
  inheritStdio?: boolean;
  /** Working directory. */
  cwd?: string;
  /** Extra environment variables to set on top of process.env. */
  env?: Record<string, string>;
  /** If true, do not actually spawn — return a "would-run" exit code 0. */
  printOnly?: boolean;
  /** Optional label for diagnostics (e.g. "mise oci build"). */
  label?: string;
}

export interface SpawnResult {
  exitCode: number;
  /** For print-only mode, this is the argv that would have been run. */
  printedArgv?: string[];
}

const DEFAULT_INHERIT = true;

function stdioFor(inherit: boolean): ["inherit", "inherit", "inherit"] | ["pipe", "pipe", "pipe"] {
  return inherit ? ["inherit", "inherit", "inherit"] : ["pipe", "pipe", "pipe"];
}

/**
 * Run a subprocess. Returns the exit code without throwing on non-zero.
 *
 * In `printOnly` mode, no process is spawned — the function returns exit 0
 * so callers can treat print mode uniformly.
 */
export async function run(argv: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const inherit = options.inheritStdio ?? DEFAULT_INHERIT;
  if (options.printOnly) {
    return { exitCode: 0, printedArgv: argv };
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.env ?? {}),
  };
  const proc = Bun.spawn({
    cmd: argv,
    cwd: options.cwd,
    env,
    stdio: stdioFor(inherit),
  });
  const exitCode = await proc.exited;
  return { exitCode };
}

/**
 * Synchronous variant — used when callers need a quick check (e.g. `which`).
 */
export function runSync(argv: string[], options: SpawnOptions = {}): SpawnResult {
  const inherit = options.inheritStdio ?? DEFAULT_INHERIT;
  if (options.printOnly) {
    return { exitCode: 0, printedArgv: argv };
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.env ?? {}),
  };
  const proc = Bun.spawnSync({
    cmd: argv,
    cwd: options.cwd,
    env,
    stdio: stdioFor(inherit),
  });
  return { exitCode: proc.exitCode };
}

/**
 * Locate an executable on PATH. Returns the resolved path or null.
 */
export function which(binary: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const pathEnv = env["PATH"];
  if (pathEnv === undefined) return null;
  const dirs = pathEnv.split(":");
  for (const dir of dirs) {
    if (dir.length === 0) continue;
    const candidate = `${dir}/${binary}`;
    if (!existsSync(candidate)) continue;
    try {
      const st = statSync(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) {
        return candidate;
      }
    } catch {
      // not present
    }
  }
  return null;
}

/**
 * Convenience: run an external command and exit the process on non-zero.
 * Used by build/lifecycle flows where any non-zero must abort immediately.
 */
export async function runOrExit(argv: string[], options: SpawnOptions = {}): Promise<never | void> {
  const stage = options.label !== undefined ? ` [${options.label}]` : "";
  const result = await run(argv, options);
  if (result.exitCode !== 0) {
    if (options.printOnly) {
      return;
    }
    console.error(`mise-msb:${stage} command failed with exit code ${result.exitCode}`);
    process.exit(result.exitCode);
  }
}
