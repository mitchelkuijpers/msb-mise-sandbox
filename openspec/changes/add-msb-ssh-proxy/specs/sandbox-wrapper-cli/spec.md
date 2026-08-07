## MODIFIED Requirements

### Requirement: Generic lifecycle commands

The CLI SHALL provide only the setup and provisioning commands `setup`, `create`, `config`, `signing init`, and `install`, plus the non-lifecycle SSH integration commands `ssh-proxy` and `ssh-config`. It SHALL NOT provide `run`, `shell`, `exec`, `start`, `stop`, `remove`, `rm`, `list`, or `ls`. It SHALL NOT provide a wrapper-managed project image build command. `create` SHALL execute the generated `msb create` and, in stock mode, complete Docker, personal, and project bootstrap before reporting success and Remote SSH guidance. `ssh-proxy` SHALL only adapt a `.msb` OpenSSH alias to the raw microsandbox stdio SSH transport, and `ssh-config` SHALL only print reusable OpenSSH configuration. Users SHALL invoke `msb` directly for all other sandbox runtime control, connection, command execution, teardown, and listing.

#### Scenario: Provision a configured sandbox
- **WHEN** the user runs `mise-msb create <name>` with a valid configuration
- **THEN** the wrapper executes the generated `msb create` argv and completes applicable stock bootstrap stages before returning success and Remote SSH guidance

#### Scenario: Invoke non-lifecycle SSH integration
- **WHEN** the user invokes `mise-msb ssh-proxy <alias>.msb` or `mise-msb ssh-config`
- **THEN** the wrapper performs only the corresponding SSH transport adaptation or configuration rendering and does not assume ownership of sandbox lifecycle

#### Scenario: Removed runtime command is rejected
- **WHEN** the user invokes `mise-msb run`, `shell`, `exec`, `start`, `stop`, `remove`, `rm`, `list`, or `ls`
- **THEN** the wrapper rejects the command as unknown and performs no `msb` operation
