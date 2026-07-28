## ADDED Requirements

### Requirement: Docker is managed by the stock runtime
The stock image SHALL contain Docker CE and an idempotent Docker startup helper. Stock lifecycle operations SHALL start dockerd after sandbox creation and restart, wait until `docker info` succeeds, and fail before the user command with actionable daemon diagnostics when readiness cannot be reached. This guarantee SHALL apply only to stock image mode.

#### Scenario: Docker is ready after stock creation
- **WHEN** a stock sandbox is created successfully
- **THEN** the wrapper starts dockerd, waits for readiness, and `docker info` succeeds before the create command reports success

#### Scenario: Docker restarts after sandbox start
- **WHEN** a stopped stock sandbox is started
- **THEN** the wrapper invokes the idempotent startup helper and verifies Docker readiness before subsequent execution

#### Scenario: Docker startup failure blocks user command
- **WHEN** dockerd cannot become ready in a stock sandbox
- **THEN** the lifecycle command exits non-zero, reports daemon diagnostics, and does not execute the requested user command

#### Scenario: Custom image owns Docker compatibility
- **WHEN** custom image mode is selected
- **THEN** the wrapper does not claim that Docker is installed or invoke stock-only Docker helpers

### Requirement: Docker data persists in a derived disk volume
Stock mode SHALL create or reuse a disk-backed named volume `<sandbox>-docker-data`, mount it at `/var/lib/docker`, and default its capacity to 10G. The configured Docker data size SHALL be validated before creation. The volume SHALL survive sandbox stop, removal, and recreation.

#### Scenario: Missing Docker volume is created idempotently
- **WHEN** a stock sandbox is created and `<sandbox>-docker-data` does not exist
- **THEN** creation uses a named disk mount with the configured size at `/var/lib/docker`

#### Scenario: Docker cache survives recreation
- **WHEN** an image is pulled, the stock sandbox is removed, and a sandbox with the same identity is recreated
- **THEN** the same Docker volume is mounted and the pulled image remains available

#### Scenario: Conflicting explicit Docker mount is rejected
- **WHEN** stock mode config also declares an explicit mount targeting `/var/lib/docker`
- **THEN** validation fails before `msb` execution and explains that stock mode owns the target

### Requirement: Docker volume preservation is visible
Removing a stock sandbox SHALL preserve its Docker data volume and SHALL print the preserved volume name with a copyable canonical `msb volume remove` command. Removal SHALL NOT automatically delete Docker data.

#### Scenario: Remove reports preserved Docker data
- **WHEN** a stock sandbox is removed
- **THEN** output identifies `<sandbox>-docker-data` as preserved and shows how to remove it explicitly

## REMOVED Requirements

### Requirement: Docker is a user-managed base-image concern
**Reason**: The generic user-managed approach makes working Docker difficult to configure correctly and conflicts with the new always-available stock runtime.
**Migration**: Use stock image mode for wrapper-managed Docker. Externally built images remain supported through custom image mode and continue to own their Docker compatibility.
