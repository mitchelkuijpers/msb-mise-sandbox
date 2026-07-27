/**
 * Command dispatcher.
 *
 * The wrapper's entry point delegates here. We hand-roll a tiny
 * dispatcher instead of pulling in commander/yargs — the surface is small
 * enough that explicit parsing is clearer than a framework.
 */

import { runBuildCommand } from "./build.js";
import { runConfigCommand } from "./config.js";
import { runCreateCommand } from "./create.js";
import { runExecCommand } from "./exec.js";
import { runInstallCommand } from "./install.js";
import { runListCommand } from "./list.js";
import { runRemoveCommand } from "./remove.js";
import { runRunCommand } from "./run.js";
import { runShellCommand } from "./shell.js";
import { runStartCommand } from "./start.js";
import { runStopCommand } from "./stop.js";

export interface GlobalOptions {
  print: boolean;
  configPath?: string;
}

const USAGE = `mise-msb — Bun/TypeScript wrapper around mise and msb

Usage: mise-msb [options] <command> [args]

Options:
  --print, --dry-run   Print generated msb commands without executing
  --config <path>      Use a specific .sandbox.toml instead of discovery

Commands:
  build [--print]               Build OCI image from mise.toml
  create <name> [--print]       Create a sandbox
  run <name> [-- cmd...]        Create (or start) + exec command
  shell <name> [--print]        Attach interactive shell
  exec <name> -- cmd...         Execute a single command
  start <name>                  Start a stopped sandbox
  stop <name>                   Stop a running sandbox
  remove <name>                 Remove a sandbox
  list                          List sandboxes
  config                        Print the effective merged configuration
  install [--force]             Symlink wrapper into ~/.local/bin
`;

export async function dispatch(argv: string[]): Promise<void> {
  const { global, rest } = parseGlobal(argv);
  const command = rest[0];

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }

  switch (command) {
    case "build":
      await runBuildCommand(global, rest.slice(1));
      return;
    case "create":
      await runCreateCommand(global, rest.slice(1));
      return;
    case "run":
      await runRunCommand(global, rest.slice(1));
      return;
    case "shell":
      await runShellCommand(global, rest.slice(1));
      return;
    case "exec":
      await runExecCommand(global, rest.slice(1));
      return;
    case "start":
      await runStartCommand(global, rest.slice(1));
      return;
    case "stop":
      await runStopCommand(global, rest.slice(1));
      return;
    case "remove":
    case "rm":
      await runRemoveCommand(global, rest.slice(1));
      return;
    case "list":
    case "ls":
      await runListCommand(global, rest.slice(1));
      return;
    case "config":
      await runConfigCommand(global, rest.slice(1));
      return;
    case "install":
      await runInstallCommand(global, rest.slice(1));
      return;
    default:
      throw new Error(`unknown command: ${command}\n\n${USAGE}`);
  }
}

function parseGlobal(argv: string[]): { global: GlobalOptions; rest: string[] } {
  const global: GlobalOptions = { print: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--print" || arg === "--dry-run") {
      global.print = true;
    } else if (arg === "--config") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error("--config requires a path argument");
      }
      global.configPath = next;
      i += 1;
    } else if (arg.startsWith("--config=")) {
      global.configPath = arg.slice("--config=".length);
    } else {
      rest.push(arg);
    }
  }
  return { global, rest };
}
