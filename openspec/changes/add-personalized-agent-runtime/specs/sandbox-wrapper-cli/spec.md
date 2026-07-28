## ADDED Requirements

### Requirement: Stock runtime setup command
The CLI SHALL provide `setup`, `setup --force`, and non-mutating `setup --print` commands for the local stock image workflow. Setup SHALL be separate from checkout symlink installation and SHALL not run implicitly from lifecycle commands.

#### Scenario: Setup remains explicit
- **WHEN** the stock image is missing and the user runs `mise-msb create`
- **THEN** create fails with setup guidance rather than starting a hidden image build

#### Scenario: Force setup rebuilds
- **WHEN** the expected stock image exists and the user runs `mise-msb setup --force`
- **THEN** setup rebuilds and reloads the expected stock generation

## MODIFIED Requirements

### Requirement: Generic lifecycle commands

The CLI SHALL provide `setup`, `create`, `run`, `shell`, `exec`, `start`, `stop`, `remove`, `list`, and `config` commands. It SHALL NOT provide a wrapper-managed project image build command. `create` SHALL execute the generated `msb create` and, in stock mode, complete Docker, personal, and project bootstrap before reporting success; `run` SHALL create or start the configured sandbox as needed, ensure stock bootstrap as applicable, and then attach the configured or supplied command; `shell` SHALL attach an interactive TTY through `msb exec` after applicable bootstrap; `exec` SHALL preserve every argument after `--` and ensure current project tools in stock mode; direct lifecycle commands SHALL delegate to canonical `msb` operations plus documented stock-runtime stages. The wrapper SHALL propagate subprocess exit codes and SHALL not add tool-specific launch commands.

#### Scenario: Exec preserves command arguments
- **WHEN** the user runs `mise-msb exec -- bun test --timeout 5000`
- **THEN** the wrapper executes the applicable stock bootstrap stages followed by `msb exec <configured-name> -- bun test --timeout 5000` without reparsing the command arguments

#### Scenario: Existing stopped stock sandbox is started by run
- **WHEN** `mise-msb run -- bun test` targets an existing stopped stock sandbox
- **THEN** the wrapper starts it, ensures Docker and mise bootstrap, and executes `bun test`

#### Scenario: List delegates without shadow state
- **WHEN** the user runs `mise-msb list`
- **THEN** the wrapper delegates to `msb list` and reads no wrapper-owned lifecycle registry

#### Scenario: Bootstrap failure stops lifecycle sequence
- **WHEN** a stock Docker, personal, or project bootstrap stage fails
- **THEN** the wrapper returns that stage's exit status and does not execute later stages or the user command

### Requirement: Printed commands are transparent and secret-safe

Lifecycle and setup commands SHALL support `--print` and the alias `--dry-run`. Print mode SHALL show shell-escaped, copyable commands in execution order and SHALL execute no external command. Stock plans SHALL include derived mounts and Docker, personal, and project bootstrap stages. Printed secret arguments SHALL contain source environment variable names and allowed hosts only because the wrapper never resolves secret values. Print mode SHALL exit successfully when command generation succeeds.

#### Scenario: Print mode reveals generated policy but no value
- **WHEN** a secret references `SERVICE_TOKEN` for `api.example.com`
- **THEN** output contains `--secret SERVICE_TOKEN@api.example.com`, contains no value of that variable, and no subprocess runs

#### Scenario: Multi-step stock run prints execution order
- **WHEN** stock `run --print` would start, bootstrap, and execute in a sandbox
- **THEN** output shows `msb start`, Docker readiness, personal bootstrap when configured, project bootstrap, and final `msb exec` in execution order

#### Scenario: Personal mount contents remain private
- **WHEN** print mode includes a personal host configuration mount
- **THEN** output shows only the configured source and target paths and does not read or print mounted file contents
