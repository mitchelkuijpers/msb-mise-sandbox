# sandbox-docker Specification

## REMOVED Requirements

### Requirement: Docker tooling in the sandbox image

**Reason**: The wrapper builds project images from `mise.toml` and has no stock runtime image whose Docker contents it can guarantee.

**Migration**: Projects requiring Docker SHALL choose a base image that contains Docker or add the required setup to their own image composition.

### Requirement: Per-project Docker enablement

**Reason**: The central project registry and Docker-specific schema are removed in favor of generic named mounts in `.sandbox.toml`.

**Migration**: Configure a disk-backed named mount targeting `/var/lib/docker` and any required resource limits directly.

### Requirement: Docker enablement requires the stock sandbox image

**Reason**: There is no wrapper-owned stock runtime image and the wrapper does not inspect images for Docker compatibility.

**Migration**: Select a compatible base image in the project build configuration.

### Requirement: Docker data volume persistence

**Reason**: Named volume persistence and cleanup are native `msb volume` responsibilities rather than wrapper-owned Docker behavior.

**Migration**: Declare the named mount generically and manage it with canonical `msb volume` commands.

### Requirement: Manual daemon startup helper

**Reason**: The wrapper no longer installs in-image helpers.

**Migration**: Include a daemon startup helper in the selected base image or project image content when needed.

### Requirement: Registry access through the network policy

**Reason**: The wrapper translates generic project network policy and does not maintain Docker-registry-specific endpoint knowledge.

**Migration**: Add the registry's required hosts to the project's generic network allowlist.
