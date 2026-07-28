## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Project identity defaults to the project root

When no name is configured, the CLI SHALL derive a normalized sandbox name from the discovered project root directory name. That identity SHALL also derive stock-runtime named volumes. A configured name SHALL override the derived name. Image references SHALL not be derived from project identity: stock mode uses the versioned stock tag and custom mode requires an explicit reference.

#### Scenario: Name derived from project root
- **WHEN** the discovered `.sandbox.toml` is in `/work/my-project` and no name is configured
- **THEN** the sandbox name defaults to `my-project` and stock volume names use that identity

#### Scenario: Stock runtime is not derived as a project image tag
- **WHEN** no custom image mode is configured
- **THEN** lifecycle config selects the versioned stock tag instead of `<project-name>:dev`
