# sandbox-network Specification

## MODIFIED Requirements

### Requirement: Per-project published ports

The layered TOML schema SHALL accept named port tables with a required host port, optional guest port defaulting to the host port, optional protocol (`tcp` or `udp`) defaulting to `tcp`, and optional bind address defaulting to `127.0.0.1`. Validation SHALL reject invalid entries before sandbox creation. The CLI SHALL translate each merged entry to an `msb --port` value using supported forms: `[BIND_ADDRESS:]HOST_PORT:GUEST_PORT` with an optional `/udp` suffix.

#### Scenario: Forward a TCP port with defaults
- **WHEN** a named port specifies host port 8080 only
- **THEN** the generated command contains `--port 127.0.0.1:8080:8080`

#### Scenario: Forward with explicit guest port and bind
- **WHEN** a named port specifies host port 8080, guest port 80, and bind `0.0.0.0`
- **THEN** the generated command contains `--port 0.0.0.0:8080:80`

#### Scenario: Forward a UDP port
- **WHEN** a named port specifies protocol `udp`
- **THEN** the generated `--port` value includes `/udp`

#### Scenario: Forward an explicit UDP mapping
- **WHEN** a named port specifies bind `0.0.0.0`, host 5353, guest 53, and protocol `udp`
- **THEN** the generated command contains `--port 0.0.0.0:5353:53/udp`

#### Scenario: No ports configured
- **WHEN** the merged configuration defines no `ports` entries
- **THEN** the generated command contains no `--port` arguments

#### Scenario: Invalid host port rejected at registry load
- **WHEN** a port entry has a host port outside the range 1 through 65535
- **THEN** validation rejects the entry at config load with the field path and no `msb` command runs

#### Scenario: Invalid protocol rejected at registry load
- **WHEN** a port entry has a protocol other than `tcp` or `udp`
- **THEN** validation rejects the entry at config load with the field path and no `msb` command runs

#### Scenario: Invalid port is rejected before msb execution
- **WHEN** a port is outside the range 1 through 65535
- **THEN** validation exits non-zero and no `msb` command runs

### Requirement: Loopback-only default bind

When a port omits its bind address, the CLI SHALL render `127.0.0.1` explicitly so the published port is not reachable through other host interfaces. Binding to another interface SHALL require an explicit configuration value.

#### Scenario: Omitted bind defaults to loopback
- **WHEN** a TCP port omits its bind address
- **THEN** the generated `--port` value begins with `127.0.0.1:`

#### Scenario: Omitted bind is explicit in argv
- **WHEN** a TCP port omits its bind address
- **THEN** the generated `--port` value begins with `127.0.0.1:`

#### Scenario: Explicit all-interfaces bind
- **WHEN** a port specifies bind `0.0.0.0`
- **THEN** the generated `--port` value begins with `0.0.0.0:`

#### Scenario: All-interface bind requires opt-in
- **WHEN** a port specifies bind `0.0.0.0`
- **THEN** the generated `--port` value begins with `0.0.0.0:`

## ADDED Requirements

### Requirement: Egress rules translate to msb policy

The network configuration SHALL default to **allow** egress, so sandboxes can reach any destination unless the project explicitly sets `network.defaultEgress = "deny"`. Each documented `<host>:<protocol>:<port>` allow entry SHALL be translated to `--net-rule allow@<host>:<protocol>:<port>`, and the configured default SHALL be translated to `--net-default`. The wrapper SHALL not implement networking or TLS interception itself.

#### Scenario: Default allows egress when no policy is configured
- **WHEN** no `network.defaultEgress` is configured and the project does not declare an allowlist
- **THEN** creation argv contains `--net-default allow` and no `--net-rule` entries

#### Scenario: Project opts into a deny-by-default allowlist
- **WHEN** the project sets `network.defaultEgress = "deny"` and allows `api.example.com:tcp:443`
- **THEN** creation argv contains `--net-default deny --net-rule allow@api.example.com:tcp:443`

### Requirement: Secret hosts also receive network access

Each allowed host declared by a secret SHALL produce its `--secret SOURCE_ENV@HOST` argument and SHALL be present in the effective egress allowlist unless an equivalent network rule already exists.

#### Scenario: Secret host is reachable once
- **WHEN** a secret allows `api.example.com` and the network config already allows `api.example.com:tcp:443`
- **THEN** the generated command contains one equivalent egress allow rule and the scoped secret argument
