# sandbox-remote-ssh Specification

## Purpose

Provide one safe, reusable OpenSSH alias convention for connecting OpenSSH-based tools to any local microsandbox without stale host keys blocking recreated sandboxes.

## Requirements

### Requirement: Universal `.msb` SSH configuration

The CLI SHALL provide `mise-msb ssh-config`, accepting no positional arguments, that prints a copyable OpenSSH configuration matching only `Host *.msb`. The block SHALL set `User root`, invoke `mise-msb ssh-proxy %n` as the `ProxyCommand`, set `StrictHostKeyChecking no`, and set `UserKnownHostsFile /dev/null`. The command SHALL perform no filesystem mutation and SHALL start no subprocess.

#### Scenario: Print reusable configuration
- **WHEN** the user runs `mise-msb ssh-config`
- **THEN** stdout contains the deterministic `Host *.msb` block with the required user, proxy, and host-key options
- **THEN** no SSH configuration file, known-hosts file, or sandbox state is created or modified

#### Scenario: Reject configuration arguments
- **WHEN** the user runs `mise-msb ssh-config` with a positional argument
- **THEN** the command exits non-zero with usage guidance and performs no filesystem mutation or subprocess invocation

### Requirement: Alias-to-sandbox proxy routing

The CLI SHALL provide `mise-msb ssh-proxy <alias>.msb` as a transport-only command. It SHALL accept exactly one alias, require a non-empty sandbox name followed by the exact `.msb` suffix, remove that suffix once, and invoke `msb ssh serve <sandbox-name> --stdio` without shell interpolation. It SHALL not require a `.sandbox.toml` or restrict the target to sandboxes created by `mise-msb`.

#### Scenario: Route a valid alias
- **WHEN** `mise-msb ssh-proxy agent-sandbox.msb` is invoked
- **THEN** it launches the argv `msb ssh serve agent-sandbox --stdio`

#### Scenario: Route a raw microsandbox
- **WHEN** an existing sandbox was created directly through `msb` and the user connects through its `<name>.msb` alias
- **THEN** the proxy delegates that name without consulting project configuration or a wrapper-owned registry

#### Scenario: Reject an invalid alias
- **WHEN** the proxy receives a missing alias, an extra argument, an empty `.msb` name, an alias without the `.msb` suffix, or a name outside microsandbox's accepted sandbox-name syntax
- **THEN** it exits non-zero, reports the validation failure only on stderr, and does not start `msb`

### Requirement: Byte-transparent SSH transport

The SSH proxy SHALL preserve the child's stdin, stdout, and stderr streams without reading, decorating, buffering, or translating the SSH protocol bytes. It SHALL emit no wrapper status text on stdout and SHALL propagate child launch failures and non-zero termination to the invoking OpenSSH client.

#### Scenario: Preserve protocol streams
- **WHEN** the delegated `msb ssh serve --stdio` process reads bytes from stdin and writes bytes to stdout and stderr
- **THEN** the caller observes the same stream bytes with no wrapper prefix, suffix, or transformation

#### Scenario: Propagate transport failure
- **WHEN** the delegated `msb` process cannot start or terminates non-zero
- **THEN** the proxy terminates non-zero without printing normal output to stdout

### Requirement: Successful creation advertises Remote SSH access

After a non-print `mise-msb create <name>` operation and all required bootstrap stages complete successfully, the CLI SHALL print a Remote SSH hint containing the alias `<name>.msb`, identify `~/.ssh/config` as the destination for one-time setup, and identify `mise-msb ssh-config` as the command that prints the reusable block. The hint SHALL not modify SSH files or claim readiness before creation and bootstrap succeed.

#### Scenario: Successful creation prints alias
- **WHEN** sandbox `agent-sandbox` and all applicable bootstrap stages are created successfully
- **THEN** the completion output identifies `agent-sandbox.msb`, `~/.ssh/config`, and `mise-msb ssh-config`

#### Scenario: Failed creation prints no readiness hint
- **WHEN** sandbox creation or an applicable bootstrap stage fails
- **THEN** the CLI exits with that failure and does not print the Remote SSH readiness hint

#### Scenario: Print mode does not claim readiness
- **WHEN** the user runs `mise-msb create agent-sandbox --print`
- **THEN** the CLI prints the planned provisioning commands without printing the Remote SSH readiness hint

### Requirement: Relaxed host-key policy remains narrowly scoped

The reusable configuration and user documentation SHALL apply disabled host-key persistence and checking only to `Host *.msb` using the local `msb ssh serve --stdio` transport. They SHALL warn users not to apply those options globally or to ordinary remote hosts.

#### Scenario: Configuration does not weaken unrelated hosts
- **WHEN** the user copies the printed block into their SSH configuration
- **THEN** `StrictHostKeyChecking no` and `UserKnownHostsFile /dev/null` apply only to aliases matching `*.msb`

#### Scenario: Security boundary is documented
- **WHEN** the user follows the Remote SSH setup documentation
- **THEN** the documentation explains that host-key authentication is disabled for `.msb` aliases because they directly execute the local stdio bridge and warns against placing the options under `Host *`
