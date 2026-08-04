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

The CLI SHALL provide only the setup and provisioning commands `setup`, `create`, `config`, `signing init`, and `install`. It SHALL NOT provide `run`, `shell`, `exec`, `start`, `stop`, `remove`, `rm`, `list`, or `ls`. It SHALL NOT provide a wrapper-managed project image build command. `create` SHALL execute the generated `msb create` and, in stock mode, complete Docker, personal, and project bootstrap before reporting success. Users SHALL invoke `msb` directly for sandbox runtime control, connection, command execution, teardown, and listing.

#### Scenario: Provision a configured sandbox
- **WHEN** the user runs `mise-msb create <name>` with a valid configuration
- **THEN** the wrapper executes the generated `msb create` argv and completes applicable stock bootstrap stages before returning success

#### Scenario: Removed runtime command is rejected
- **WHEN** the user invokes `mise-msb run`, `shell`, `exec`, `start`, `stop`, `remove`, `rm`, `list`, or `ls`
- **THEN** the wrapper rejects the command as unknown and performs no `msb` operation

### Requirement: Printed commands are transparent and secret-safe

The `setup` and `create` commands SHALL support `--print` and the alias `--dry-run`. Print mode SHALL show shell-escaped, copyable commands in execution order and SHALL execute no external command. Stock plans SHALL include derived mounts and Docker, personal, and project bootstrap stages. Printed secret arguments SHALL contain source environment variable names, literal microsandbox placeholders, guest mappings, and allowed hosts only because the wrapper never resolves secret values. Print mode SHALL exit successfully when command generation succeeds.

#### Scenario: Print mode reveals generated policy but no value
- **WHEN** a secret references `SERVICE_TOKEN` for `api.example.com`
- **THEN** output contains `--secret SERVICE_TOKEN@api.example.com`, contains no value of that variable, and no subprocess runs

#### Scenario: Create print mode shows provisioning order
- **WHEN** stock `create --print` provisions a sandbox
- **THEN** output shows the generated `msb create` argv followed by Docker readiness, personal bootstrap when configured, and project bootstrap in execution order

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

### Requirement: Same-path project mount drives create argv

Stock sandbox creation SHALL render the built-in `project` mount as `--mount-dir <projectRoot>:<projectRoot>:rw` and SHALL render `--workdir <projectRoot>` when no explicit workdir override applies, so the guest cwd and the project mount coincide at the host-absolute path. The project bootstrap stage SHALL invoke `mise-msb-bootstrap project <workdirTarget>` with the resolved workdir. Print mode SHALL show these rendered arguments, including the bootstrap stage argument, without executing anything.

#### Scenario: Default create argv mounts the project at its host path

- **WHEN** the merged config's project root is `/host/proj` and no explicit workdir or project target is configured
- **THEN** create argv contains `--mount-dir /host/proj:/host/proj:rw` and `--workdir /host/proj`, and contains no `/workspace`-based workdir

#### Scenario: Project bootstrap stage carries the resolved workdir

- **WHEN** stock create runs the project bootstrap stage for a config whose workdir target is `/host/proj`
- **THEN** the stage argv is `mise-msb-bootstrap project /host/proj`

#### Scenario: Print mode shows the same-path mount and workdir

- **WHEN** the user runs stock `create --print` for project root `/host/proj`
- **THEN** the printed sequence contains `--mount-dir /host/proj:/host/proj:rw`, `--workdir /host/proj`, and `mise-msb-bootstrap project /host/proj`, and no external command executes

