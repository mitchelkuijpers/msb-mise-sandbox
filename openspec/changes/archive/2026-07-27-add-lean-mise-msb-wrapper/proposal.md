## Why

The current sandbox CLI duplicates image building, project registration, lifecycle, and microsandbox SDK behavior that `mise` and `msb` now provide directly. A small, transparent wrapper can instead turn layered TOML configuration into inspectable `mise oci` and `msb` commands, making sandbox setup reusable across mise-based projects without maintaining a central project registry.

## What Changes

- **BREAKING**: Replace the project-registry and microsandbox-SDK-oriented CLI with a stateless Bun/TypeScript wrapper around the `mise` and `msb` CLIs.
- Add layered configuration with built-in defaults, personal defaults at `~/.config/mise-msb/config.toml`, project configuration at `.sandbox.toml`, and final CLI overrides.
- Add deterministic merge behavior for resources, environment variables, network rules, secrets, mounts, image settings, and commands.
- Add a Linux-hosted `mise oci build` workflow that creates an OCI layout from the project's `mise.toml`, archives it, and imports it into the local microsandbox image cache.
- Add small lifecycle commands for build, create, run, shell, exec, stop, remove, and printing the generated commands.
- Add an idempotent installation command and mise task that symlink the tool into `~/.local/bin` without modifying shell startup files.
- Keep secret values out of configuration and wrapper state; configuration names host environment variables and allowed destinations only.
- Remove interactive project registration, the central `projects.json` registry, agent-specific launch commands, SDK-specific workarounds, and Docker-specific lifecycle orchestration from the wrapper.

## Capabilities

### New Capabilities
- `layered-sandbox-config`: Personal and project TOML discovery, validation, deterministic merging, naming, and CLI overrides.
- `mise-oci-image`: Linux-safe image construction from `mise.toml`, OCI layout import into microsandbox, tagging, and build diagnostics.
- `sandbox-wrapper-cli`: Transparent `msb` command generation and execution, lifecycle conveniences, dry-run output, and installation into `~/.local/bin`.

### Modified Capabilities
- `sandbox-network`: Move network and published-port configuration from the central project registry and SDK builder calls to layered TOML translated into `msb` CLI arguments.
- `sandbox-docker`: Remove Docker-specific image validation, registry schema, prompts, and volume lifecycle from the wrapper; Docker becomes an optional base-image and generic-mount concern.

## Impact

- Replaces most of `src/commands/` and `src/lib/` with a substantially smaller Bun CLI focused on config loading, command generation, and process execution.
- Replaces `~/.agent-sandbox/projects.json` with optional personal defaults and checked-in per-project `.sandbox.toml` files.
- Uses Bun's TOML parser, subprocess API, and test runner; no microsandbox SDK dependency is required.
- Uses experimental `mise oci build`, which must execute in Linux to avoid embedding host-native macOS binaries.
- Continues to require the installed `msb` CLI and a Linux builder image capable of running mise.
- Changes existing command names and project setup behavior; migration documentation will show equivalent `.sandbox.toml` configuration.
