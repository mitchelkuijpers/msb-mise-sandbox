/**
 * Command dispatcher.
 *
 * The wrapper's entry point delegates here. We hand-roll a tiny
 * dispatcher instead of pulling in commander/yargs — the surface is small
 * enough that explicit parsing is clearer than a framework.
 */

import { runConfigCommand } from "./config.js";
import { runCreateCommand } from "./create.js";
import { runInstallCommand } from "./install.js";
import { runSetupCommand } from "./setup.js";
import { runSigningCommand } from "./signing.js";
import { runSshConfigCommand, runSshProxyCommand } from "./ssh.js";

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
  setup [--print] [--force]     Build and load the local stock runtime image
  create <name> [--print]       Create a sandbox
  config                        Print the effective merged configuration
  signing init [--force]        Generate the sandbox commit-signing keypair
  install [--force]             Symlink wrapper into ~/.local/bin
  ssh-proxy <name>.msb          Adapt a .msb SSH alias to the raw msb stdio transport
  ssh-config                    Print the reusable Host *.msb OpenSSH block
`;

export async function dispatch(argv: string[]): Promise<void> {
  const { global, rest } = parseGlobal(argv);
  const command = rest[0];

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }

  switch (command) {
    case "setup":
      await runSetupCommand(global, rest.slice(1));
      return;
    case "create":
      await runCreateCommand(global, rest.slice(1));
      return;
    case "config":
      await runConfigCommand(global, rest.slice(1));
      return;
    case "signing":
      await runSigningCommand(global, rest.slice(1));
      return;
    case "install":
      await runInstallCommand(global, rest.slice(1));
      return;
    case "ssh-proxy":
      await runSshProxyCommand(rest.slice(1));
      return;
    case "ssh-config":
      await runSshConfigCommand(rest.slice(1));
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
