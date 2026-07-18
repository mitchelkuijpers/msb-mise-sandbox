## ADDED Requirements

### Requirement: Sandbox lifecycle management

The CLI SHALL manage microsandbox microVMs through a subcommand surface compatible with the existing `bin/agent-sandbox` CLI: `create`, `start`, `stop`, `restart`, `shell`, `exec`, `list`, `remove`, and `doctor`. Each subcommand SHALL map to the microsandbox TS SDK or `msb` CLI. The `create` command SHALL accept a project name and read configuration from the project registry.

#### Scenario: Create a sandbox for a registered project

- **WHEN** the user runs `agent-sandbox create <project>` and the project exists in the registry
- **THEN** the CLI reads the project config, calls `Sandbox.builder(<project>)` with the configured image, resources, mounts, secrets, env, and network policy, and boots the microVM

#### Scenario: Start a stopped sandbox

- **WHEN** the user runs `agent-sandbox start <project>` and a stopped sandbox with that name exists
- **THEN** the CLI calls `msb start <project>` and the microVM resumes

#### Scenario: Stop a running sandbox

- **WHEN** the user runs `agent-sandbox stop <project>` and a running sandbox with that name exists
- **THEN** the CLI calls `msb stop <project>` and the microVM stops gracefully

#### Scenario: Remove a sandbox

- **WHEN** the user runs `agent-sandbox remove <project>` and a sandbox with that name exists
- **THEN** the CLI stops (if running) and removes the sandbox and its runtime state

#### Scenario: List all sandboxes

- **WHEN** the user runs `agent-sandbox list`
- **THEN** the CLI calls `msb list` and prints each sandbox name, image, status, and creation time

### Requirement: Interactive shell and command execution

The CLI SHALL provide `shell <project>` for an interactive bash session and `exec <project> -- <cmd>` for a single command, both via the microsandbox host-guest command channel (not SSH).

#### Scenario: Open an interactive shell

- **WHEN** the user runs `agent-sandbox shell <project>` and the sandbox is running
- **THEN** the CLI opens an interactive bash session inside the sandbox via `msb shell` or `msb exec -- bash`

#### Scenario: Execute a single command

- **WHEN** the user runs `agent-sandbox exec <project> -- <cmd> [args...]`
- **THEN** the CLI runs the command inside the sandbox via `msb exec` and streams stdout/stderr to the host terminal

### Requirement: OCI image management

The CLI SHALL support building a custom OCI image from the project's `Containerfile` and loading it into the microsandbox image cache. The image SHALL include Ubuntu 24.04, mise, and the tools pinned in `mise.toml` (node, python, opencode, codex, ripgrep, fd).

#### Scenario: Build and load the custom image

- **WHEN** the user runs `agent-sandbox build`
- **THEN** the CLI builds the image from `Containerfile` using docker or podman, and loads it into the microsandbox cache via `msb image load`

#### Scenario: Use a stock image

- **WHEN** the project config specifies a stock image (e.g., `python:3.12-slim`) instead of the custom image
- **THEN** the CLI pulls it via `msb pull` if not cached, and uses it for the sandbox

### Requirement: Resource limits

The CLI SHALL apply per-project CPU and memory limits from the project registry. Defaults SHALL be 4 CPUs and 8 GiB memory if not specified.

#### Scenario: Apply configured resource limits

- **WHEN** a project config specifies `resources: { cpus: 2, memory: "4G" }`
- **THEN** the CLI calls `.cpus(2).memory(4096)` on the sandbox builder

#### Scenario: Apply defaults when unspecified

- **WHEN** a project config omits the `resources` field
- **THEN** the CLI applies 4 CPUs and 8192 MiB memory

### Requirement: Tool provisioning via mise

The OCI image SHALL install mise and the tools pinned in `mise.toml` so that opencode, codex, node, python, ripgrep, and fd are available inside the sandbox on first boot.

#### Scenario: Tools available on first boot

- **WHEN** a sandbox is created from the custom image and the user runs `agent-sandbox exec <project> -- mise ls`
- **THEN** the output lists node, python, opencode, codex, ripgrep, and fd at their pinned versions

### Requirement: Agent execution commands

The CLI SHALL provide `opencode <project>` and `codex <project>` subcommands that launch the respective agent interactively inside the sandbox.

#### Scenario: Launch opencode

- **WHEN** the user runs `agent-sandbox opencode <project>` and the sandbox is running
- **THEN** the CLI runs `opencode` interactively inside the sandbox via `msb exec` with a TTY

#### Scenario: Launch codex

- **WHEN** the user runs `agent-sandbox codex <project>` and the sandbox is running
- **THEN** the CLI runs `codex` interactively inside the sandbox via `msb exec` with a TTY

### Requirement: Doctor health check

The CLI SHALL provide a `doctor` subcommand that verifies microsandbox is installed, the hypervisor is available, the custom OCI image is cached, and the project registry is valid.

#### Scenario: All checks pass

- **WHEN** the user runs `agent-sandbox doctor` and microsandbox is installed, `msb doctor` passes, the custom image is cached, and `projects.json` is valid
- **THEN** the CLI prints a passing status for each check

#### Scenario: Missing dependency

- **WHEN** the user runs `agent-sandbox doctor` and microsandbox is not installed
- **THEN** the CLI prints a failing status for the microsandbox check and exits non-zero
