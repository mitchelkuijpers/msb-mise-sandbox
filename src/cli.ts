#!/usr/bin/env bun
/**
 * agent-sandbox — CLI entry point.
 *
 * Manages microsandbox microVMs for coding agents (OpenCode, Codex, Pi).
 * Uses the microsandbox TS SDK for sandbox lifecycle and the project
 * registry (~/.agent-sandbox/projects.json) for per-project config.
 */

import { Command } from "commander";
import { buildImage } from "./commands/build.js";
import { createCommand } from "./commands/create.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { restartCommand } from "./commands/restart.js";
import { removeCommand } from "./commands/remove.js";
import { listCommand } from "./commands/list.js";
import { shellCommand } from "./commands/shell.js";
import { execCommand } from "./commands/exec.js";
import { opencodeCommand } from "./commands/opencode.js";
import { codexCommand } from "./commands/codex.js";
import { piCommand } from "./commands/pi.js";
import { projectAddCommand } from "./commands/project-add.js";
import { projectListCommand } from "./commands/project-list.js";
import { projectRemoveCommand } from "./commands/project-remove.js";
import { doctorCommand } from "./commands/doctor.js";

const program = new Command();

program
  .name("agent-sandbox")
  .description("MicroVM sandbox for coding agents")
  .version("0.1.0");

// ---------------------------------------------------------------------------
// Lifecycle commands
// ---------------------------------------------------------------------------

program
  .command("build")
  .description("Build the custom OCI image and load it into microsandbox")
  .action(() => {
    return buildImage().catch((err) => {
      console.error("Build failed:", (err as Error).message);
      process.exit(1);
    });
  });

program
  .command("create <project>")
  .description("Create a sandbox for a registered project")
  .action((project: string) => {
    return createCommand(project).catch((err) => {
      console.error("Create failed:", (err as Error).message);
      process.exit(1);
    });
  });

program
  .command("start <project>")
  .description("Start a stopped sandbox")
  .action((project: string) => {
    return startCommand(project).catch((err) => {
      console.error("Start failed:", (err as Error).message);
      process.exit(1);
    });
  });

program
  .command("stop <project>")
  .description("Stop a running sandbox")
  .action((project: string) => {
    return stopCommand(project).catch((err) => {
      console.error("Stop failed:", (err as Error).message);
      process.exit(1);
    });
  });

program
  .command("restart <project>")
  .description("Restart a sandbox")
  .action((project: string) => {
    return restartCommand(project).catch((err) => {
      console.error("Restart failed:", (err as Error).message);
      process.exit(1);
    });
  });

program
  .command("remove <project>")
  .description("Remove a sandbox")
  .action((project: string) => {
    return removeCommand(project).catch((err) => {
      console.error("Remove failed:", (err as Error).message);
      process.exit(1);
    });
  });

program
  .command("list")
  .description("List all sandboxes")
  .action(() => {
    return listCommand().catch((err) => {
      console.error("List failed:", (err as Error).message);
      process.exit(1);
    });
  });

// ---------------------------------------------------------------------------
// Interactive / exec commands
// ---------------------------------------------------------------------------

program
  .command("shell <project>")
  .description("Open an interactive shell inside the sandbox")
  .action((project: string) => {
    return shellCommand(project).catch((err) => {
      console.error("Shell failed:", (err as Error).message);
      process.exit(1);
    });
  });

program
  .command("exec <project>")
  .description("Execute a command inside the sandbox")
  .argument("[command...]", "Command and arguments to execute")
  .action((project: string, command: string[]) => {
    return execCommand(project, command).catch((err) => {
      console.error("Exec failed:", (err as Error).message);
      process.exit(1);
    });
  });

// ---------------------------------------------------------------------------
// Agent commands (stubs — to be implemented)
// ---------------------------------------------------------------------------

program
  .command("opencode <project>")
  .description("Launch OpenCode inside the sandbox")
  .action((project: string) => {
    return opencodeCommand(project).catch((err) => {
      console.error("OpenCode failed:", (err as Error).message);
      process.exit(1);
    });
  });

program
  .command("codex <project>")
  .description("Launch Codex inside the sandbox")
  .action((project: string) => {
    return codexCommand(project).catch((err) => {
      console.error("Codex failed:", (err as Error).message);
      process.exit(1);
    });
  });

program
  .command("pi <project>")
  .description("Launch Pi inside the sandbox")
  .action((project: string) => {
    return piCommand(project).catch((err) => {
      console.error("Pi failed:", (err as Error).message);
      process.exit(1);
    });
  });

// ---------------------------------------------------------------------------
// Project registry commands (stubs — to be implemented)
// ---------------------------------------------------------------------------

const projectCmd = program
  .command("project")
  .description("Manage the project registry");

projectCmd
  .command("add <name>")
  .description("Add a new project to the registry")
  .action((name: string) => {
    return projectAddCommand(name).catch((err) => {
      console.error("Project add failed:", (err as Error).message);
      process.exit(1);
    });
  });

projectCmd
  .command("list")
  .description("List all registered projects")
  .action(() => {
    return projectListCommand().catch((err) => {
      console.error("Project list failed:", (err as Error).message);
      process.exit(1);
    });
  });

projectCmd
  .command("remove <name>")
  .description("Remove a project from the registry")
  .action((name: string) => {
    return projectRemoveCommand(name).catch((err) => {
      console.error("Project remove failed:", (err as Error).message);
      process.exit(1);
    });
  });

// ---------------------------------------------------------------------------
// Doctor (stub — to be implemented)
// ---------------------------------------------------------------------------

program
  .command("doctor")
  .description("Run health checks on the agent-sandbox setup")
  .action(() => {
    return doctorCommand().catch((err) => {
      console.error("Doctor failed:", (err as Error).message);
      process.exit(1);
    });
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

await program.parseAsync(process.argv);
