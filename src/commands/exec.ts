/**
 * `agent-sandbox exec <project> [command...]` — execute a command.
 */

import { execInSandbox } from "../lib/sandbox.js";

export async function execCommand(
  project: string,
  command: string[],
): Promise<void> {
  if (command.length === 0) {
    console.error("No command specified. Usage: agent-sandbox exec <project> <command> [args...]");
    process.exit(1);
  }

  const cmd = command[0];
  const args = command.slice(1);

  const result = await execInSandbox(project, cmd, args);

  // Print stdout (TTY mode merges stdout/stderr into stdout).
  const out = result.stdout();
  if (out) process.stdout.write(out);

  const err = result.stderr();
  if (err) process.stderr.write(err);

  if (!result.success) {
    process.exitCode = result.code;
  }
}
