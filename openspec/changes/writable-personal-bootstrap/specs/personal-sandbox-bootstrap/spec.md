# personal-sandbox-bootstrap Delta

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Guest-originated bootstrap changes propagate to other sandboxes
Because guest writes mutate the host bootstrap directory, the existing content-hash change detection SHALL treat guest-originated edits identically to host-originated edits: any sandbox whose applied marker no longer matches the current hash SHALL re-run personal bootstrap on its next lifecycle invocation.

#### Scenario: Tool added in one sandbox appears in another
- **WHEN** sandbox A runs `mise use -g <tool>` (changing the host bootstrap content) and sandbox B later runs any stock lifecycle command
- **THEN** sandbox B re-runs personal bootstrap and the tool becomes available there

#### Scenario: Guest edit re-runs bootstrap in the originating sandbox
- **WHEN** a guest process edits bootstrap content without installing tools (e.g. edits a hook script)
- **THEN** the next lifecycle invocation of that same sandbox detects the hash change and re-runs personal bootstrap
