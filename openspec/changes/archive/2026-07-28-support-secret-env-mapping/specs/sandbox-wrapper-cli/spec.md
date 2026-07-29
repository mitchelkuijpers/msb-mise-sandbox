## MODIFIED Requirements

### Requirement: Safe deterministic msb argv generation

The CLI SHALL construct subprocess argv arrays without shell interpolation and SHALL use canonical `msb` command names. Sandbox creation SHALL render the image as the positional argument to `msb create`; render resources with `--cpus` and `--memory`; environment entries with `--env KEY=value`; published ports with `--port`; network policy with `--net-default` and repeatable `--net-rule`; secrets with repeatable `--secret SOURCE_ENV@HOST`; and mounts with the explicit `--mount-dir`, `--mount-file`, `--mount-disk`, or `--mount-named` flag selected by mount kind. When a named secret's guest key differs from its source environment variable, sandbox creation SHALL also render `--env GUEST_NAME=$MSB_SOURCE_ENV`. Named entries SHALL be emitted in sorted name order.

#### Scenario: Complete config becomes valid msb create argv
- **WHEN** the merged config defines an image, resources, environment, ports, network rules, secrets, and mounts
- **THEN** the wrapper generates one deterministic `msb create <image> --name <name> ...` argv array using only supported `msb` flags

#### Scenario: Arguments are not evaluated by a shell
- **WHEN** an environment value or host path contains spaces or shell metacharacters
- **THEN** the exact value is passed as one subprocess argument and no shell expansion occurs

#### Scenario: Differing secret names generate a guest bridge
- **WHEN** guest secret `OPENCODE_API_KEY` uses source `OPENCODE_API_KEY_PERSONAL`
- **THEN** create argv contains `--env OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL` and the source-based `--secret` arguments in deterministic order

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
