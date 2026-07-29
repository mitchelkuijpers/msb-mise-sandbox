# sandbox-wrapper-cli Specification

## Purpose
TBD - created by archiving change add-lean-mise-msb-wrapper. Update Purpose after archive.
## Requirements
### Requirement: Safe deterministic msb argv generation

The CLI SHALL construct subprocess argv arrays without shell interpolation and SHALL use canonical `msb` command names. Sandbox creation SHALL render the image as the positional argument to `msb create`; render resources with `--cpus` and `--memory`; environment entries with `--env KEY=value`; published ports with `--port`; network policy with `--net-default` and repeatable `--net-rule`; secrets with repeatable `--secret SOURCE_ENV@HOST`; and mounts with the explicit `--mount-dir`, `--mount-file`, `--mount-disk`, or `--mount-named` flag selected by mount kind. When a named secret's guest key differs from its source environment variable, sandbox creation SHALL also render `--env GUEST_NAME=$MSB_SOURCE_ENV`. Named entries SHALL be emitted in sorted name order. When `[signing]` is enabled, sandbox creation SHALL additionally render, in deterministic positions: read-only `--mount-file` entries for the signing private key and public key at their fixed guest targets under `/etc/mise-msb/signing/`, a `--copy` entry delivering the wrapper-generated guest gitconfig to `/etc/mise-msb/gitconfig`, and `--env GIT_CONFIG_GLOBAL=/etc/mise-msb/gitconfig`. Signing emission SHALL NOT place key material in argv or environment values.

#### Scenario: Complete config becomes valid msb create argv
- **WHEN** the merged config defines an image, resources, environment, ports, network rules, secrets, and mounts
- **THEN** the wrapper generates one deterministic `msb create <image> --name <name> ...` argv array using only supported `msb` flags

#### Scenario: Arguments are not evaluated by a shell
- **WHEN** an environment value or host path contains spaces or shell metacharacters
- **THEN** the exact value is passed as one subprocess argument and no shell expansion occurs

#### Scenario: Differing secret names generate a guest bridge
- **WHEN** guest secret `OPENCODE_API_KEY` uses source `OPENCODE_API_KEY_PERSONAL`
- **THEN** create argv contains `--env OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL` and the source-based `--secret` arguments in deterministic order

#### Scenario: Enabled signing extends create argv deterministically
- **WHEN** the merged config enables signing with a valid key
- **THEN** create argv contains the two read-only signing `--mount-file` entries, the generated-gitconfig `--copy` entry, and the `GIT_CONFIG_GLOBAL` environment entry, and repeated generation with identical inputs produces identical argv

#### Scenario: Disabled signing leaves argv unchanged
- **WHEN** the merged config does not enable signing
- **THEN** generated create argv contains no signing mounts, no generated-gitconfig copy, and no `GIT_CONFIG_GLOBAL` entry

### Requirement: Generic lifecycle commands

The CLI SHALL provide `setup`, `create`, `run`, `shell`, `exec`, `start`, `stop`, `remove`, `list`, `config`, and `signing init` commands. It SHALL NOT provide a wrapper-managed project image build command. `create` SHALL execute the generated `msb create` and, in stock mode, complete Docker, personal, and project bootstrap before reporting success; `run` SHALL create or start the configured sandbox as needed, ensure stock bootstrap as applicable, and then attach the configured or supplied command; `shell` SHALL attach an interactive TTY through `msb exec` after applicable bootstrap; `exec` SHALL preserve every argument after `--` and ensure current project tools in stock mode; direct lifecycle commands SHALL delegate to canonical `msb` operations plus documented stock-runtime stages. The wrapper SHALL propagate subprocess exit codes and SHALL not add tool-specific launch commands. `signing init` SHALL perform signing key generation as specified in the sandbox-commit-signing capability and SHALL NOT create, start, or modify any sandbox.

#### Scenario: Exec preserves command arguments
- **WHEN** the user runs `mise-msb exec -- bun test --timeout 5000`
- **THEN** the wrapper executes the applicable stock bootstrap stages followed by `msb exec <configured-name> -- bun test --timeout 5000` without reparsing the command arguments

#### Scenario: Existing stopped sandbox is started by run
- **WHEN** `mise-msb run -- bun test` targets an existing stopped stock sandbox
- **THEN** the wrapper starts it, ensures Docker and mise bootstrap, and executes `bun test`

#### Scenario: List delegates without shadow state
- **WHEN** the user runs `mise-msb list`
- **THEN** the wrapper delegates to `msb list` and reads no wrapper-owned lifecycle registry

#### Scenario: Bootstrap failure stops lifecycle sequence
- **WHEN** a stock Docker, personal, or project bootstrap stage fails
- **THEN** the wrapper returns that stage's exit status and does not execute later stages or the user command

#### Scenario: Signing validation failure prevents sandbox creation
- **WHEN** `[signing]` is enabled and any signing key validation check fails
- **THEN** `create` (and any command that would create the sandbox) exits non-zero with the validation error and executes no `msb` command

### Requirement: Printed commands are transparent and secret-safe

Lifecycle and setup commands SHALL support `--print` and the alias `--dry-run`. Print mode SHALL show shell-escaped, copyable commands in execution order and SHALL execute no external command. Stock plans SHALL include derived mounts and Docker, personal, and project bootstrap stages. Printed secret arguments SHALL contain source environment variable names, literal microsandbox placeholders, guest mappings, and allowed hosts only because the wrapper never resolves secret values. Print mode SHALL exit successfully when command generation succeeds.

#### Scenario: Print mode reveals generated policy but no value
- **WHEN** a secret references `SERVICE_TOKEN` for `api.example.com`
- **THEN** output contains `--secret SERVICE_TOKEN@api.example.com`, contains no value of that variable, and no subprocess runs

#### Scenario: Multi-step run prints execution order
- **WHEN** stock `run --print` would start, bootstrap, and execute in a sandbox
- **THEN** output shows `msb start`, Docker readiness, personal bootstrap when configured, project bootstrap, and final `msb exec` in execution order

#### Scenario: Personal mount contents remain private
- **WHEN** print mode includes a personal host configuration mount
- **THEN** output shows only the configured source and target paths and does not read or print mounted file contents

#### Scenario: Print mode shows mapped placeholder without secret value
- **WHEN** guest secret `OPENCODE_API_KEY` uses source `OPENCODE_API_KEY_PERSONAL`
- **THEN** output shows the guest mapping to `$MSB_OPENCODE_API_KEY_PERSONAL` and the allowed-host source argument but does not contain the value of `OPENCODE_API_KEY_PERSONAL`

### Requirement: Idempotent local symlink installation

The CLI SHALL provide `install [--force]` that creates `~/.local/bin` when absent and symlinks `~/.local/bin/mise-msb` to the repository's executable entry point. Reinstalling the same target SHALL succeed without changing it. A different symlink, regular file, or directory at the destination SHALL cause a non-zero exit without modification unless `--force` is supplied; force mode SHALL replace a file or symlink but SHALL refuse to recursively remove a directory. The command SHALL not edit shell startup files and SHALL warn without failing when `~/.local/bin` is absent from `PATH`.

#### Scenario: First install creates the symlink
- **WHEN** the destination does not exist
- **THEN** `install` creates the parent directory as needed and creates the symlink

#### Scenario: Reinstall is a no-op
- **WHEN** the destination already resolves to the same entry point
- **THEN** `install` exits successfully without replacing it

#### Scenario: Collision requires force
- **WHEN** the destination points elsewhere and `--force` is absent
- **THEN** the command reports existing and desired targets and leaves the destination unchanged

#### Scenario: Install does not modify dotfiles
- **WHEN** `~/.local/bin` is not in `PATH`
- **THEN** installation succeeds with a PATH hint and no shell startup file is modified

### Requirement: Repository mise installation task

The tool repository's `mise.toml` SHALL provide an installation task that invokes the wrapper's `install` command, allowing a checkout to be installed with `mise run install`. The wrapper SHALL NOT generate or overwrite tasks in consumer projects.

#### Scenario: Mise task installs the checkout
- **WHEN** the user runs `mise run install` in the tool repository
- **THEN** the task invokes the same idempotent symlink installation behavior

### Requirement: Stock runtime setup command
The CLI SHALL provide `setup`, `setup --force`, and non-mutating `setup --print` commands for the local stock image workflow. Setup SHALL be separate from checkout symlink installation and SHALL not run implicitly from lifecycle commands.

#### Scenario: Setup remains explicit
- **WHEN** the stock image is missing and the user runs `mise-msb create`
- **THEN** create fails with setup guidance rather than starting a hidden image build

#### Scenario: Force setup rebuilds
- **WHEN** the expected stock image exists and the user runs `mise-msb setup --force`
- **THEN** setup rebuilds and reloads the expected stock generation

