/**
 * Lifecycle delegation to `msb` commands.
 *
 * The wrapper's `create`, `start`, `stop`, `remove`, `shell`, `exec`,
 * `run`, `list` commands all funnel through this module. It owns the
 * `run` state handling (absent / stopped / running) and the print-only
 * flag.
 */

import type { SandboxConfig } from "../config/types.js";
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
  // msb list returns a multi-column table on stdout. We capture stdout via
  // Bun.spawnSync so we can inspect it without echoing it to the terminal.
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
    // Heuristic: a "running" sandbox has an active state column (e.g.
    // "running" or "active"). Stopped names still appear in `msb list`.
    if (/\brunning\b|\bactive\b/.test(line)) {
      return "running";
    }
    return "stopped";
  }
  return "absent";
}

/**
 * Sequence of argv arrays for `run`: each element is a separate msb
 * invocation in execution order. Returned in print order so callers can
 * render them as a multi-step block.
 */
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
}

export function planRunSequence(input: RunSequenceInput): RunSequence {
  const name = input.name ?? input.config.identity.name;
  const groups: string[][] = [];

  // Step 1: determine state via msb list (not added to argv sequence; it
  // is a read-only inspection step that does not get printed).
  let state: SandboxState = "absent";
  if (!input.config.command && !input.commandArgv) {
    // For pure "run" without a command we still create + start, then msb
    // exec attaches the default shell. msb list is only consulted when we
    // need to know whether to start or replace.
    state = "absent"; // we'll let `create --replace` handle re-creation
  } else {
    state = querySandboxState(name);
  }

  if (state === "absent") {
    groups.push(
      buildCreateArgv({
        image: input.image,
        name,
        config: input.config,
        replace: input.replace,
      }),
    );
  } else if (state === "stopped") {
    groups.push(buildStartArgv(name));
  }
  // If state === "running", no startup step is needed.

  // Step 2: exec the command.
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
