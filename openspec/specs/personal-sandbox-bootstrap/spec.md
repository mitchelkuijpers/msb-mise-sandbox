# personal-sandbox-bootstrap Specification

## Purpose
TBD - created by archiving change add-personalized-agent-runtime. Update Purpose after archive.
## Requirements
### Requirement: Optional personal bootstrap discovery
The CLI SHALL discover one optional personal bootstrap at `~/.config/mise-msb/bootstrap/mise.toml`, using the configured XDG config home when present. If it exists, the wrapper SHALL mount its containing directory **writable** in a stock sandbox and set `MISE_GLOBAL_CONFIG_FILE` to the mounted file. The mount source path SHALL be canonicalized (symlinks resolved) before mounting. A missing personal bootstrap SHALL be valid and SHALL add no personal mount or bootstrap stage.

#### Scenario: Personal bootstrap is discovered
- **WHEN** the user's mise-msb config directory contains `bootstrap/mise.toml`
- **THEN** stock creation mounts the bootstrap directory writable at the documented guest path and exposes that file as mise global configuration

#### Scenario: Global tool install writes through to the host
- **WHEN** a guest process runs `mise use -g <tool>` in a stock sandbox
- **THEN** the personal bootstrap `mise.toml` on the host is updated and the tool is installed in the sandbox

#### Scenario: Guest edits to sibling bootstrap files persist
- **WHEN** a guest process creates or modifies a file under the mounted bootstrap directory
- **THEN** the change is present in the host bootstrap directory

#### Scenario: Bootstrap source under a symlinked path still mounts
- **WHEN** the resolved personal bootstrap directory path traverses a symlink (e.g. a symlinked config home)
- **THEN** the wrapper mounts the canonicalized directory successfully

#### Scenario: Personal bootstrap is absent
- **WHEN** no personal bootstrap file exists
- **THEN** stock creation proceeds without a personal bootstrap mount or personal provisioning command

### Requirement: Full personal bootstrap runs outside project context
The stock lifecycle SHALL apply personal mise bootstrap packages, repositories, dotfiles, tools, and hooks from a neutral working directory that is not inside the project workspace. Project configuration SHALL NOT be loaded as part of the trusted personal full-bootstrap stage. Personal bootstrap SHALL execute as trusted operator-owned code inside the microVM.

#### Scenario: Personal bootstrap installs personal tools
- **WHEN** the personal global config declares ripgrep and bootstrap packages
- **THEN** the personal stage installs them without requiring declarations in the project repository

#### Scenario: Project hooks are excluded from personal bootstrap
- **WHEN** both personal and project mise files define bootstrap hooks
- **THEN** the personal full-bootstrap stage executes only the user-owned global bootstrap directives

### Requirement: Personal bootstrap changes are detected
The wrapper SHALL derive a deterministic content hash from the personal bootstrap directory and the stock helper SHALL store the applied hash in sandbox-local writable state. Personal bootstrap SHALL run for a new sandbox and when the hash changes, and SHALL skip unchanged warm invocations. The marker SHALL NOT live in the persistent mise volume.

#### Scenario: Unchanged personal bootstrap is skipped
- **WHEN** a sandbox has already applied the current personal bootstrap hash
- **THEN** a later warm lifecycle invocation skips full personal provisioning

#### Scenario: Supporting file change triggers bootstrap
- **WHEN** a file under the personal bootstrap directory changes
- **THEN** the next stock lifecycle invocation applies personal bootstrap and updates the sandbox-local marker

#### Scenario: Recreated sandbox runs bootstrap again
- **WHEN** a sandbox is removed and recreated while its mise volume persists
- **THEN** personal bootstrap runs because the sandbox-local marker was removed with the sandbox

### Requirement: Guest-originated bootstrap changes propagate to other sandboxes
Because guest writes mutate the host bootstrap directory, the existing content-hash change detection SHALL treat guest-originated edits identically to host-originated edits: any sandbox whose applied marker no longer matches the current hash SHALL re-run personal bootstrap on its next lifecycle invocation.

#### Scenario: Tool added in one sandbox appears in another
- **WHEN** sandbox A runs `mise use -g <tool>` (changing the host bootstrap content) and sandbox B later runs any stock lifecycle command
- **THEN** sandbox B re-runs personal bootstrap and the tool becomes available there

#### Scenario: Guest edit re-runs bootstrap in the originating sandbox
- **WHEN** a guest process edits bootstrap content without installing tools (e.g. edits a hook script)
- **THEN** the next lifecycle invocation of that same sandbox detects the hash change and re-runs personal bootstrap

### Requirement: Personal and project mise tools share isolated persistent state
Stock sandboxes SHALL use a per-project directory-backed named volume mounted at `/mise` for mise data, cache, config, and state. Mise SHALL merge the mounted personal global config with configuration discovered from the project workspace, with normal mise precedence. Before a user command, the stock lifecycle SHALL trust the selected project config and run `mise install --locked` when `mise.lock` exists or `mise install` otherwise.

#### Scenario: Personal and project tools are installed
- **WHEN** personal config declares ripgrep and project config declares Bun
- **THEN** project bootstrap makes both tools available through the persistent mise installation

#### Scenario: Lockfile selects locked installation
- **WHEN** the project root contains `mise.lock`
- **THEN** project bootstrap invokes mise installation in locked mode and propagates an incomplete or invalid lockfile failure

#### Scenario: Project without lockfile remains low-friction
- **WHEN** the project root has no `mise.lock`
- **THEN** project bootstrap installs tools from `mise.toml` without requiring a lockfile

#### Scenario: Projects do not share mise state
- **WHEN** two projects have different resolved sandbox names
- **THEN** each receives a different mise named volume

### Requirement: Host configuration mounts remain explicit personal configuration
The wrapper SHALL NOT discover or implicitly mount host configuration or credential paths. Developers MAY declare narrowly scoped host file or directory mounts in personal `config.toml`; these mounts SHALL retain their configured read-only or writable semantics and SHALL be visible in effective config and print mode. Documentation SHALL warn that guest code can read mounted credentials and modify writable host mounts.

#### Scenario: Personal host configuration mount is applied
- **WHEN** personal config declares a host directory mount targeting a guest tool configuration path
- **THEN** every merged sandbox using that personal config receives exactly that explicit mount

#### Scenario: No implicit host credentials
- **WHEN** personal config declares no credential-bearing mount
- **THEN** sandbox creation contains no automatically discovered host configuration mount

#### Scenario: Writable credential mount is transparent
- **WHEN** personal config declares a writable OAuth configuration mount
- **THEN** effective config and print mode identify the writable mount without reading or printing file contents
