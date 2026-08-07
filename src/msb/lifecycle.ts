/**
 * Lifecycle delegation to `msb` commands.
 *
 * The wrapper's `create`, `start`, `stop`, `remove`, `shell`, `exec`,
 * `run`, `list` commands all funnel through this module. It owns the
 * `run` state handling (absent / stopped / running) and the print-only
 * flag.
 */

import type { SandboxConfig } from "../config/types.js";
import { type ValidatedSigningKey } from "../signing/validate.js";
import {
  buildCreateArgv,
  buildExecArgv,
  buildListArgv,
  buildRemoveArgv,
  buildRunArgv,
  buildStartArgv,
  buildStopArgv,
  mountArgv,
} from "./argv.js";
import { run, type SpawnResult } from "./subprocess.js";
import type { GitIdentity } from "../signing/gitconfig.js";
import {
  DOCKER_UP_HELPER,
  BOOTSTRAP_HELPER,
  STOCK_IMAGE_TAG,
} from "../stock-image/constants.js";
import { discoverPersonalBootstrap, hashBootstrapDir } from "../bootstrap/discovery.js";

export interface RunCommandInput {
  argv: string[];
  /** When true, suppress actual execution and return print metadata. */
  printOnly: boolean;
  /** Optional label for error messages. */
  label?: string;
}

export interface RunCommandOutput {
  exitCode: number;
  /** When print-only, the argv array that would have been executed. */
  printedArgv?: string[];
}

/** Run an external command (or just return print metadata). */
export async function runCommand(input: RunCommandInput): Promise<RunCommandOutput> {
  return run(input.argv, {
    printOnly: input.printOnly,
    label: input.label,
  });
}

/**
 * Determine the current state of a named sandbox by reading `msb list`.
 * Returns one of: "absent", "stopped", "running".
 *
 * msb list outputs a table; we parse lines and match by name in the first
 * column. The exact column count varies between msb versions, so we look
 * for the name as a whole-token match anywhere on the line.
 */
export type SandboxState = "absent" | "stopped" | "running";

export function querySandboxState(name: string): SandboxState {
  const proc = Bun.spawnSync({
    cmd: ["msb", "list"],
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (proc.exitCode !== 0) {
    return "absent";
  }
  const stdout = proc.stdout.toString();
  for (const line of stdout.split("\n")) {
    if (!line.includes(name)) continue;
    if (/\brunning\b|\bactive\b/.test(line)) {
      return "running";
    }
    return "stopped";
  }
  return "absent";
}

/**
 * Check whether the expected stock image is loaded.
 * Used as a preflight before stock sandbox creation.
 */
export function stockImageIsLoaded(): boolean {
  const proc = Bun.spawnSync({
    cmd: ["msb", "image", "list"],
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (proc.exitCode !== 0) return false;
  return proc.stdout.toString().includes(STOCK_IMAGE_TAG);
}

/**
 * Build stock bootstrap argv groups for a named sandbox.
 * Returns groups in execution order: Docker readiness, personal bootstrap
 * (if configured), project bootstrap.
 */
export interface StockBootstrapInput {
  name: string;
  config: SandboxConfig;
  homeDir?: string;
}

export function planStockBootstrapStages(input: StockBootstrapInput): string[][] {
  const groups: string[][] = [];
  const { name, config } = input;

  // Stage: Docker readiness (stock mode only).
  if (config.stock.imageMode === "stock") {
    groups.push(buildExecArgv(name, [DOCKER_UP_HELPER]));
  }

  // Stage: personal bootstrap (if configured).
  const personal = discoverPersonalBootstrap(input.homeDir);
  if (personal !== null) {
    const hash = hashBootstrapDir(personal.dir);
    groups.push(buildExecArgv(name, [
      BOOTSTRAP_HELPER,
      "personal",
      hash,
    ]));
  }

  // Stage: browser trust (stock mode only) — import runtime local CAs into
  // Chrome's NSS database after personal bootstrap establishes NSS state and
  // before project bootstrap or user commands can start a browser.
  if (config.stock.imageMode === "stock") {
    groups.push(buildExecArgv(name, [BOOTSTRAP_HELPER, "browser-trust"]));
  }

  // Stage: project bootstrap, run in the resolved workdir (the
  // same-path project mount target by default).
  groups.push(buildExecArgv(name, [BOOTSTRAP_HELPER, "project", config.workdirTarget]));

  return groups;
}

// ---------------------------------------------------------------------------
// Sequence of argv arrays for `run`: each element is a separate msb
// invocation in execution order.
// ---------------------------------------------------------------------------

export interface RunSequence {
  groups: string[][];
  /** The sandbox name in use. */
  name: string;
}

export interface RunSequenceInput {
  config: SandboxConfig;
  /** Project image (used for the create step). */
  image: string;
  /** Optional command override (e.g. argv from the CLI). */
  commandArgv?: string[];
  /** Optional pre-existing sandbox name override. */
  name?: string;
  /** Force replacement rather than start-existing. */
  replace?: boolean;
  /** Optional home dir override (used in tests). */
  homeDir?: string;
  /** Validated signing key pair for canonical mount paths. */
  signingKey?: ValidatedSigningKey;
  /** Committer identity for the generated guest gitconfig (signing mode). */
  gitIdentity?: GitIdentity;
  /**
   * Optional state probe, injectable so planning stays deterministic
   * without a host `msb` binary. Defaults to `querySandboxState`.
   */
  queryState?: (name: string) => SandboxState;
}

export function planRunSequence(input: RunSequenceInput): RunSequence {
  const name = input.name ?? input.config.identity.name;
  const groups: string[][] = [];

  // Probe the sandbox state only when a command will actually run. The
  // probe defaults to the `msb list` subprocess check and is injectable
  // so planning tests don't depend on a host binary.
  const queryState = input.queryState ?? querySandboxState;
  let state: SandboxState = "absent";
  if (input.config.command || input.commandArgv) {
    state = queryState(name);
  }

  if (state === "absent") {
    groups.push(
      buildCreateArgv({
        image: input.image,
        name,
        config: input.config,
        replace: input.replace,
        signingKey: input.signingKey,
        gitIdentity: input.gitIdentity,
      }),
    );
  } else if (state === "stopped") {
    groups.push(buildStartArgv(name));
  }

  // Stock mode: inject bootstrap stages.
  if (input.config.stock.imageMode === "stock") {
    const bootstrap = planStockBootstrapStages({
      name,
      config: input.config,
      homeDir: input.homeDir,
    });
    groups.push(...bootstrap);
  }

  const command = input.commandArgv ?? input.config.command?.argv ?? ["bash"];
  groups.push(buildExecArgv(name, command));

  return { groups, name };
}

// ---------------------------------------------------------------------------
// Builders re-exported for command files
// ---------------------------------------------------------------------------

export const LifecycleArgv = {
  create: buildCreateArgv,
  start: buildStartArgv,
  stop: buildStopArgv,
  remove: buildRemoveArgv,
  list: buildListArgv,
  exec: buildExecArgv,
  run: buildRunArgv,
  mount: mountArgv,
};

// Helper: when callers need to run with print + exit code propagation.
export async function execLifecycle(
  argv: string[],
  printOnly: boolean,
  label: string,
): Promise<number> {
  const result: SpawnResult = await run(argv, { printOnly, label });
  return result.exitCode;
}
