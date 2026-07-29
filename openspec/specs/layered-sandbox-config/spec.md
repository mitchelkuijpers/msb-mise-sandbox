# layered-sandbox-config Specification

## Purpose
TBD - created by archiving change add-lean-mise-msb-wrapper. Update Purpose after archive.
## Requirements
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

The CLI SHALL reject unknown keys and invalid values with an error that identifies the source file and field path. Sandbox names and custom image references SHALL be non-empty and CLI-safe where required; image modes SHALL be supported values; CPU counts SHALL be positive integers; memory and Docker disk size SHALL use an `M` or `G` suffix; mount targets SHALL be absolute guest paths and SHALL not conflict with stock-reserved targets; port numbers SHALL be integers from 1 through 65535; environment and secret names SHALL be valid environment variable identifiers; and network rules SHALL use the wrapper's documented `<host>:<protocol>:<port>` syntax. Validation SHALL finish before external commands execute.

#### Scenario: Unknown key is rejected
- **WHEN** `.sandbox.toml` contains `runtime.memroy = "8G"`
- **THEN** validation identifies `runtime.memroy` as unknown and executes no external command

#### Scenario: Invalid mount target is rejected
- **WHEN** a named mount has `target = "workspace"`
- **THEN** validation reports that the target must be an absolute guest path

#### Scenario: Invalid Docker volume size is rejected
- **WHEN** the configured Docker size omits an `M` or `G` suffix
- **THEN** validation identifies the invalid Docker-size field and executes no external command

### Requirement: Secret configuration contains references only

Each named secret key SHALL be a valid guest environment variable name and SHALL contain a source host environment variable name plus one or more allowed hosts, but SHALL NOT contain a value. The wrapper SHALL verify that each referenced source variable is present without reading or printing its value. It SHALL generate source-based `msb --secret SOURCE_ENV@HOST` arguments and, when the guest name differs from the source name, SHALL map the guest variable to the literal `$MSB_<SOURCE_ENV>` placeholder. The wrapper SHALL never place a real secret value in configuration, wrapper state, logs, or argv.

#### Scenario: Present source generates source-based arguments
- **WHEN** `secrets.OPENAI_API_KEY.from = "OPENAI_API_KEY"`, its allowlist contains `api.openai.com`, and that host variable is present
- **THEN** the wrapper generates `--secret OPENAI_API_KEY@api.openai.com` without resolving the value and does not require a separate guest bridge

#### Scenario: Missing source fails before creation
- **WHEN** a configured secret references an unset host environment variable
- **THEN** the CLI names the missing variable, exits non-zero, and creates no sandbox resource

#### Scenario: Different guest and source names are mapped
- **WHEN** `secrets.OPENCODE_API_KEY.from = "OPENCODE_API_KEY_PERSONAL"` and its allowlist contains `opencode.ai`
- **THEN** the guest receives `OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL` while the wrapper emits `--secret OPENCODE_API_KEY_PERSONAL@opencode.ai` without resolving the host value

#### Scenario: Invalid guest secret name is rejected
- **WHEN** a secret table key is not a valid environment variable identifier
- **THEN** validation identifies that secret key, exits non-zero, and executes no external command

### Requirement: Project identity defaults to the project root

When no name is configured, the CLI SHALL derive a normalized sandbox name from the discovered project root directory name. That identity SHALL also derive stock-runtime named volumes. A configured name SHALL override the derived name. Image references SHALL not be derived from project identity: stock mode uses the versioned stock tag and custom mode requires an explicit reference.

#### Scenario: Name derived from project root
- **WHEN** the discovered `.sandbox.toml` is in `/work/my-project` and no name is configured
- **THEN** the sandbox name defaults to `my-project` and stock volume names use that identity

#### Scenario: Stock runtime is not derived as a project image tag
- **WHEN** no custom image mode is configured
- **THEN** lifecycle config selects the versioned stock tag instead of `<project-name>:dev`

### Requirement: Stock runtime settings are typed and layered
The layered TOML schema SHALL support an image mode defaulting to `stock`, a `custom` image mode with a required explicit image reference, and a Docker data size defaulting to 10G. Personal and project layers SHALL merge these scalar settings by existing precedence rules, and validation SHALL reject unsupported modes, a missing custom reference, or an invalid Docker size before external commands execute. The schema SHALL no longer accept the retired `[build]` table and SHALL not introduce a mise-specific quota setting.

#### Scenario: Built-in stock defaults apply
- **WHEN** neither personal nor project config declares stock runtime settings
- **THEN** effective config selects stock mode with a 10G Docker data default and no mise quota

#### Scenario: Personal Docker size can be overridden by project config
- **WHEN** personal config selects a 20G Docker size and project config selects 30G
- **THEN** effective config uses the project Docker size according to normal scalar precedence

#### Scenario: Invalid image mode fails closed
- **WHEN** project config selects an unsupported image mode
- **THEN** validation identifies the field, exits non-zero, and executes no external command

#### Scenario: Custom image requires a reference
- **WHEN** project config selects custom image mode without an image reference
- **THEN** validation identifies the missing reference and executes no external command

#### Scenario: Retired build config is rejected
- **WHEN** config declares a `[build]` table
- **THEN** strict validation reports the table as unsupported and executes no external command

### Requirement: Derived stock state cannot be shadowed
After resolving sandbox identity, stock mode SHALL deterministically derive the mise and Docker named-volume sources and inject their reserved guest targets. Explicit merged mounts SHALL not be allowed to target `/mise` or `/var/lib/docker` in stock mode. Custom image mode SHALL retain generic mount behavior.

#### Scenario: Derived names use resolved identity
- **WHEN** effective sandbox identity is `demo`
- **THEN** stock creation derives `demo-mise-v1` and `demo-docker-data` as its persistent volume names

#### Scenario: Reserved target conflict fails before creation
- **WHEN** stock config declares an explicit mount at `/mise`
- **THEN** validation names the conflicting mount and creates no sandbox resource

#### Scenario: Custom image keeps generic mounts
- **WHEN** custom image mode declares a generic mount at `/var/lib/docker`
- **THEN** the mount is rendered normally and no stock-derived Docker mount is added

### Requirement: Signing configuration section

The layered schema SHALL accept an optional `[signing]` table with the
keys `enabled` (boolean, default `false`) and `key` (host path string,
supporting `~` expansion). The table SHALL merge across layers by the
standard scalar-replacement rule and MAY appear in any layer, including
the committed project `.sandbox.toml`. Strict schema validation SHALL
reject unknown keys inside `[signing]`, non-boolean `enabled` values,
and non-string or empty `key` values, with errors identifying the source
file and field path. When `enabled` is `false` or the table is absent,
the `key` field SHALL be ignored for validation of key-file properties
and no signing behavior SHALL activate.

#### Scenario: Personal layer supplies the key, project opts in
- **WHEN** the personal config sets `signing.key` and the project config sets `signing.enabled = true`
- **THEN** the merged configuration has signing enabled with the personal key path

#### Scenario: Project layer overrides key path
- **WHEN** both personal and project layers set `signing.key` and the project layer is higher precedence
- **THEN** the merged configuration uses the project key path, subject to key validation

#### Scenario: Unknown signing key rejected
- **WHEN** a config layer contains `signing.bits = 256`
- **THEN** validation fails naming the file and the unknown `signing.bits` field

#### Scenario: Disabled signing skips key-file validation
- **WHEN** `signing.enabled` is `false` or absent and `signing.key` names a nonexistent file
- **THEN** configuration loads successfully and no signing validation or argv emission occurs

