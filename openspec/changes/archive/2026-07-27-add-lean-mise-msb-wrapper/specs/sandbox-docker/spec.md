# sandbox-docker Specification

## ADDED Requirements

### Requirement: Docker is a user-managed base-image concern

Docker tooling, daemon startup, named data-volume persistence, and registry endpoints SHALL no longer be wrapper-owned responsibilities. Projects that need Docker inside the sandbox MUST declare their requirements through generic `mise oci build` composition (selecting a base image that contains Docker) and generic named mounts in `.sandbox.toml` (for `/var/lib/docker` persistence). The wrapper MUST NOT inspect images, manage Docker volumes, install `docker-up` helpers, or carry Docker-specific knowledge of registry endpoints.

#### Scenario: Project declares a Docker-enabled base image in .sandbox.toml
- **WHEN** a project needs Docker inside the sandbox
- **THEN** it sets `[build].from` to an image that already includes Docker (or composes one via `mise oci build`)

#### Scenario: Project declares /var/lib/docker persistence as a generic mount
- **WHEN** a project needs `/var/lib/docker` to persist across sandbox removals
- **THEN** it adds a `disk` mount in `[mounts]` targeting `/var/lib/docker` instead of toggling a wrapper-owned Docker flag

#### Scenario: Project adds registry hosts to generic network allowlist
- **WHEN** a project pulls images from a Docker registry
- **THEN** it lists the registry's required hosts under `[network].allow` like any other egress destination

## REMOVED Requirements

### Requirement: Docker tooling in the sandbox image

**Reason**: The wrapper builds project images from `mise.toml` and has no stock runtime image whose Docker contents it can guarantee.

**Migration**: Projects requiring Docker SHALL choose a base image that contains Docker or add the required setup to their own image composition.

#### Scenario: Wrapper does not bundle Docker in any default image
- **WHEN** the wrapper builds an OCI image from `mise.toml` with no Docker-related declarations
- **THEN** the resulting image does not contain a `dockerd` binary or `docker` CLI by virtue of the wrapper

### Requirement: Per-project Docker enablement

**Reason**: The central project registry and Docker-specific schema are removed in favor of generic named mounts in `.sandbox.toml`.

**Migration**: Configure a disk-backed named mount targeting `/var/lib/docker` and any required resource limits directly.

#### Scenario: Project opt-in via generic mounts instead of registry
- **WHEN** a project needs Docker in the sandbox
- **THEN** it declares a disk-backed mount in `.sandbox.toml` rather than toggling a wrapper-owned Docker flag

### Requirement: Docker enablement requires the stock sandbox image

**Reason**: There is no wrapper-owned stock runtime image and the wrapper does not inspect images for Docker compatibility.

**Migration**: Select a compatible base image in the project build configuration.

#### Scenario: Wrapper does not inspect images for Docker compatibility
- **WHEN** a project builds its own OCI image with `mise oci build`
- **THEN** the wrapper does not fail the build because the image lacks Docker tooling

### Requirement: Docker data volume persistence

**Reason**: Named volume persistence and cleanup are native `msb volume` responsibilities rather than wrapper-owned Docker behavior.

**Migration**: Declare the named mount generically and manage it with canonical `msb volume` commands.

#### Scenario: Wrapper does not manage Docker data volumes
- **WHEN** a project removes its sandbox
- **THEN** the wrapper does not emit Docker-volume-specific cleanup beyond the generic `msb volume` commands documented for the user

### Requirement: Manual daemon startup helper

**Reason**: The wrapper no longer installs in-image helpers.

**Migration**: Include a daemon startup helper in the selected base image or project image content when needed.

#### Scenario: Wrapper does not ship docker-up
- **WHEN** a project uses the wrapper
- **THEN** the wrapper does not install a `docker-up` script into the runtime image

### Requirement: Registry access through the network policy

**Reason**: The wrapper translates generic project network policy and does not maintain Docker-registry-specific endpoint knowledge.

**Migration**: Add the registry's required hosts to the project's generic network allowlist.

#### Scenario: Wrapper treats Docker registries like any other host
- **WHEN** a project needs to pull a Docker image
- **THEN** it lists registry hosts (e.g. `registry-1.docker.io`) under `[network].allow` like any other egress destination
