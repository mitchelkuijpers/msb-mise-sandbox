# sandbox-wrapper-cli Specification

## Purpose

Provide a small Bun CLI that transparently translates merged configuration into `msb` commands, manages common lifecycle operations, and installs itself into `~/.local/bin`.

## ADDED Requirements

### Requirement: Safe deterministic msb argv generation

The CLI SHALL construct subprocess argv arrays without shell interpolation and SHALL use canonical `msb` command names. Sandbox creation SHALL render the image as the positional argument to `msb create`; render resources with `--cpus` and `--memory`; environment entries with `--env KEY=value`; published ports with `--port`; network policy with `--net-default` and repeatable `--net-rule`; secrets with repeatable `--secret SOURCE_ENV@HOST`; and mounts with the explicit `--mount-dir`, `--mount-file`, `--mount-disk`, or `--mount-named` flag selected by mount kind. Named entries SHALL be emitted in sorted name order.

#### Scenario: Complete config becomes valid msb create argv
- **WHEN** the merged config defines an image, resources, environment, ports, network rules, secrets, and mounts
- **THEN** the wrapper generates one deterministic `msb create <image> --name <name> ...` argv array using only supported `msb` flags

#### Scenario: Arguments are not evaluated by a shell
- **WHEN** an environment value or host path contains spaces or shell metacharacters
- **THEN** the exact value is passed as one subprocess argument and no shell expansion occurs

### Requirement: Generic lifecycle commands

The CLI SHALL provide `build`, `create`, `run`, `shell`, `exec`, `start`, `stop`, `remove`, `list`, and `config` commands. `create` SHALL execute the generated `msb create`; `run` SHALL create or start the configured sandbox as needed and then attach the configured or supplied command; `shell` SHALL attach an interactive TTY through `msb exec`; `exec` SHALL preserve every argument after `--`; direct lifecycle commands SHALL delegate to their canonical `msb` equivalent. The wrapper SHALL propagate subprocess exit codes.

#### Scenario: Exec preserves command arguments
- **WHEN** the user runs `mise-msb exec -- bun test --timeout 5000`
- **THEN** the wrapper executes `msb exec <configured-name> -- bun test --timeout 5000` without reparsing the command arguments

#### Scenario: Existing stopped sandbox is started by run
- **WHEN** `mise-msb run -- opencode` targets an existing stopped sandbox
- **THEN** the wrapper starts it and executes `opencode`

#### Scenario: List delegates without shadow state
- **WHEN** the user runs `mise-msb list`
- **THEN** the wrapper delegates to `msb list` and reads no wrapper-owned lifecycle registry

### Requirement: Printed commands are transparent and secret-safe

Lifecycle and build commands SHALL support `--print` and the alias `--dry-run`. Print mode SHALL show shell-escaped, copyable commands in execution order and SHALL execute no external command. Printed secret arguments SHALL contain source environment variable names and allowed hosts only because the wrapper never resolves secret values. Print mode SHALL exit successfully when command generation succeeds.

#### Scenario: Print mode reveals generated policy but no value
- **WHEN** a secret references `OPENAI_API_KEY` for `api.openai.com`
- **THEN** output contains `--secret OPENAI_API_KEY@api.openai.com`, contains no value of that variable, and no subprocess runs

#### Scenario: Multi-step run prints execution order
- **WHEN** `run --print` would start and then execute in a sandbox
- **THEN** output shows the `msb start` command before the `msb exec` command

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
