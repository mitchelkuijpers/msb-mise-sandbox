## ADDED Requirements

### Requirement: Per-project published ports

The project registry schema SHALL accept an optional `ports` array of structured port specifications. Each entry SHALL be an object with a required `hostPort` (integer 1-65535), an optional `guestPort` (integer 1-65535, defaulting to `hostPort` when omitted), an optional `protocol` (`"tcp"` or `"udp"`, defaulting to `"tcp"`), and an optional `bind` (host bind address string, defaulting to `"127.0.0.1"`). The `ports` array SHALL default to an empty array when absent. Registry validation SHALL reject invalid entries at load time with an error naming the project, the invalid entry, and the constraint violated.

#### Scenario: Forward a TCP port with defaults

- **WHEN** a project config includes `ports: [{ hostPort: 8080 }]` and the sandbox is created
- **THEN** the CLI calls the builder's TCP port method with host port 8080 and guest port 8080, bound to 127.0.0.1

#### Scenario: Forward with explicit guest port and bind

- **WHEN** a project config includes `ports: [{ hostPort: 80, guestPort: 8080, bind: "0.0.0.0" }]` and the sandbox is created
- **THEN** the CLI calls the builder's TCP port-bind method with bind `0.0.0.0`, host port 80, and guest port 8080

#### Scenario: Forward a UDP port

- **WHEN** a project config includes `ports: [{ hostPort: 5353, protocol: "udp" }]` and the sandbox is created
- **THEN** the CLI calls the builder's UDP port method with host port 5353 and guest port 5353, bound to 127.0.0.1

#### Scenario: No ports configured

- **WHEN** a project config has no `ports` field (or an empty array) and the sandbox is created
- **THEN** no port-publishing builder methods are called

#### Scenario: Invalid host port rejected at registry load

- **WHEN** a project config includes `ports: [{ hostPort: 0 }]` and the registry is loaded
- **THEN** validation fails with an error naming the project, the invalid entry, and stating that ports must be integers 1-65535

#### Scenario: Invalid protocol rejected at registry load

- **WHEN** a project config includes `ports: [{ hostPort: 80, protocol: "sctp" }]` and the registry is loaded
- **THEN** validation fails with an error stating that protocol must be "tcp" or "udp"

### Requirement: Loopback-only default bind

When a port specification omits the `bind` field, the CLI SHALL bind the published port to `127.0.0.1` (loopback only), making it reachable from the host but not from the LAN or external network. Binding to other interfaces SHALL require an explicit `bind` value (e.g. `"0.0.0.0"` or a specific interface address).

#### Scenario: Omitted bind defaults to loopback

- **WHEN** a port specification omits `bind` and the sandbox is created
- **THEN** the published port is reachable from the host at 127.0.0.1 and not from other network interfaces

#### Scenario: Explicit all-interfaces bind

- **WHEN** a port specification sets `bind: "0.0.0.0"` and the sandbox is created
- **THEN** the published port is reachable from the host and from the LAN at the host's network address
