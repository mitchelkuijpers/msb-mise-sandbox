# layered-sandbox-config Specification

## Purpose

Define stateless personal and project TOML configuration that merges into a deterministic sandbox definition without a central project registry.

## ADDED Requirements

### Requirement: Configuration discovery and precedence

The CLI SHALL merge configuration in this order: built-in defaults, optional personal defaults at `~/.config/mise-msb/config.toml`, the nearest `.sandbox.toml` found by walking from the current directory toward the filesystem root, then CLI overrides. The CLI SHALL use an explicitly supplied `--config <path>` instead of project discovery when present. A missing optional file SHALL be ignored, while an existing file with invalid TOML SHALL cause a non-zero exit before any `mise` or `msb` command executes.

#### Scenario: Project values override personal defaults
- **WHEN** personal defaults set `runtime.cpus = 2` and the discovered project config sets `runtime.cpus = 6`
- **THEN** the merged configuration uses 6 CPUs

#### Scenario: Explicit config disables discovery
- **WHEN** the user supplies `--config /tmp/example.toml`
- **THEN** the CLI loads that project configuration without searching parent directories for `.sandbox.toml`

#### Scenario: Malformed optional config fails closed
- **WHEN** the personal or project config exists but contains malformed TOML
- **THEN** the CLI names the file and parse error, exits non-zero, and executes no external command

### Requirement: Deterministic merge rules

The CLI SHALL merge scalar values by replacing the lower-precedence value, recursively merge tables, and replace command arrays. Named `env`, `secrets`, `mounts`, and `ports` tables SHALL merge by entry name with the higher-precedence entry replacing a conflicting lower-precedence entry. `network.allow` SHALL append and deduplicate lower-to-higher precedence rules unless the higher-precedence network table sets `inherit = false`, in which case its rules SHALL replace inherited rules. Identical inputs SHALL produce identical merged configuration and generated argv order.

#### Scenario: Named tables merge without ambiguous array identity
- **WHEN** personal defaults define `mounts.cache`, the project defines `mounts.workspace`, and the project replaces `mounts.cache`
- **THEN** the result contains `workspace` and the project version of `cache`

#### Scenario: Network rules inherit by default
- **WHEN** personal defaults allow `github.com:tcp:443` and the project allows `api.example.com:tcp:443`
- **THEN** the merged allowlist contains both rules exactly once

#### Scenario: Project can discard personal network rules
- **WHEN** the project sets `network.inherit = false` and allows only `api.example.com:tcp:443`
- **THEN** the merged allowlist contains only the project rule

### Requirement: Strict schema validation

The CLI SHALL reject unknown keys and invalid values with an error that identifies the source file and field path. Sandbox names and image tags SHALL be non-empty and CLI-safe; CPU counts SHALL be positive integers; memory SHALL use an `M` or `G` suffix; mount targets SHALL be absolute guest paths; port numbers SHALL be integers from 1 through 65535; environment and secret names SHALL be valid environment variable identifiers; and network rules SHALL use the wrapper's documented `<host>:<protocol>:<port>` syntax. Validation SHALL finish before external commands execute.

#### Scenario: Unknown key is rejected
- **WHEN** `.sandbox.toml` contains `runtime.memroy = "8G"`
- **THEN** validation identifies `runtime.memroy` as unknown and executes no external command

#### Scenario: Invalid mount target is rejected
- **WHEN** a named mount has `target = "workspace"`
- **THEN** validation reports that the target must be an absolute guest path

### Requirement: Secret configuration contains references only

Each named secret SHALL contain a source host environment variable name and one or more allowed hosts, but SHALL NOT contain a value. The wrapper SHALL verify that each referenced variable is present without reading or printing its value. It SHALL generate source-based `msb --secret SOURCE_ENV@HOST` arguments and SHALL never place a real secret value in configuration, wrapper state, logs, or argv.

#### Scenario: Present source generates source-based arguments
- **WHEN** `secrets.OPENAI_API_KEY.from = "OPENAI_API_KEY"`, its allowlist contains `api.openai.com`, and that host variable is present
- **THEN** the wrapper generates `--secret OPENAI_API_KEY@api.openai.com` without resolving the value

#### Scenario: Missing source fails before creation
- **WHEN** a configured secret references an unset host environment variable
- **THEN** the CLI names the missing variable, exits non-zero, and creates no sandbox resource

### Requirement: Project identity defaults to the project root

When no name is configured, the CLI SHALL derive a normalized sandbox name and local image tag from the discovered project root directory name. A configured name SHALL override the derived name.

#### Scenario: Name derived from project root
- **WHEN** the discovered `.sandbox.toml` is in `/work/my-project` and no name is configured
- **THEN** the sandbox name defaults to `my-project`
