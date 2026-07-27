# sandbox-docker Specification

## Purpose
TBD - created by archiving change add-docker-support. Update Purpose after archive.
## Requirements
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

