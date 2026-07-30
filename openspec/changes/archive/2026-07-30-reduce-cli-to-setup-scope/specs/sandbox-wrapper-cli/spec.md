## MODIFIED Requirements

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
