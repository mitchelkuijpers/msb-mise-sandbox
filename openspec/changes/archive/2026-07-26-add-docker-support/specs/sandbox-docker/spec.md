## ADDED Requirements

### Requirement: Docker tooling in the sandbox image

The sandbox OCI image SHALL include the Docker CE engine: `dockerd`, the `docker` CLI, `containerd`, the buildx plugin, and the compose v2 plugin, installed from Docker's official apt repository. The image build SHALL verify the binaries with version checks and SHALL NOT start the Docker daemon at build time.

#### Scenario: Image contains working Docker binaries

- **WHEN** the image is built via `agent-sandbox build`
- **THEN** `docker --version`, `dockerd --version`, `docker buildx version`, and `docker compose version` all succeed inside the built image

#### Scenario: No daemon runs at build time

- **WHEN** the image is built
- **THEN** no `dockerd` process is started during the build and the image boots without a running daemon

### Requirement: Per-project Docker enablement

The project registry schema SHALL accept an optional `docker` section with `enabled` (boolean, default `false`) and `dataVolumeSize` (string, default `"10G"`). `dataVolumeSize` SHALL match `^[0-9]+[MG]$` — a positive integer with an uppercase `M` (MiB) or `G` (GiB) suffix, e.g. `"10G"`, `"50G"`, `"2048M"` — and SHALL be at least 1024 MiB. Registry validation SHALL reject a non-conforming `dataVolumeSize` at load time with an error naming the project, the invalid value, and the expected format. When `docker.enabled` is `true`, sandbox creation SHALL mount a disk-backed named volume at `/var/lib/docker`. When absent or `false`, sandbox creation SHALL NOT create or mount any Docker volume. The interactive `project add` command SHALL prompt whether to enable Docker support, noting that it requires the stock sandbox image.

#### Scenario: Sandbox created with Docker enabled

- **WHEN** a project config has `docker.enabled: true` and the sandbox is created
- **THEN** a disk-backed named volume is mounted at `/var/lib/docker` and `dockerd` can start with its default storage driver

#### Scenario: Sandbox created without Docker config

- **WHEN** a project config has no `docker` section (or `enabled: false`) and the sandbox is created
- **THEN** no volume is mounted at `/var/lib/docker` and no named Docker volume is created

#### Scenario: Malformed data volume size rejected at registry load

- **WHEN** a project config has `docker.dataVolumeSize: "10GB"` (or any value not matching `^[0-9]+[MG]$`, such as `"10GiB"` or `"10g"`) and the registry is loaded
- **THEN** validation fails with an error naming the project, the invalid value, and the expected `M`/`G` format

#### Scenario: Data volume size below the minimum rejected

- **WHEN** a project config has `docker.dataVolumeSize: "512M"` and the registry is loaded
- **THEN** validation fails with an error stating the minimum size of 1024 MiB (1G)

#### Scenario: Custom data volume size honored

- **WHEN** a docker-enabled project config has `docker.dataVolumeSize: "50G"` and the sandbox is created
- **THEN** the `<project>-docker-data` volume is created with a 50 GiB capacity

#### Scenario: Interactive project registration

- **WHEN** the user runs `agent-sandbox project add <name>` and answers the Docker prompt
- **THEN** the stored project config reflects the chosen `docker.enabled` value

### Requirement: Docker enablement requires the stock sandbox image

Docker tooling (engine, CLI, plugins, `docker-up`) is installed only in the stock `agent-sandbox:latest` image. When `docker.enabled` is `true`, sandbox creation SHALL verify that the project's `image` is the stock image or its fully-qualified alias `docker.io/library/agent-sandbox:latest`, and SHALL otherwise fail before creating the sandbox or any volume with an actionable error stating that Docker support requires the stock image.

#### Scenario: Custom image with Docker enabled is rejected

- **WHEN** a project config has `docker.enabled: true` with `image` set to any other OCI image and the user runs `agent-sandbox create`
- **THEN** creation fails with an error explaining that Docker support requires the stock `agent-sandbox:latest` image, and no sandbox or Docker volume is created

#### Scenario: Stock image alias accepted

- **WHEN** a project config has `docker.enabled: true` and `image: "docker.io/library/agent-sandbox:latest"` and the user runs `agent-sandbox create`
- **THEN** creation proceeds and the Docker data volume is mounted at `/var/lib/docker`

### Requirement: Docker data volume persistence

The Docker data volume SHALL be named `<project>-docker-data`, SHALL be disk-backed (ext4), SHALL be created-or-reused idempotently at sandbox creation, and SHALL persist after the sandbox is removed, preserving pulled images and build cache. On sandbox removal the CLI SHALL print the preserved volume name and the `msb volume rm <project>-docker-data` cleanup command.

#### Scenario: Volume survives sandbox removal

- **WHEN** a docker-enabled sandbox has pulled images and is removed via `agent-sandbox remove`
- **THEN** the `<project>-docker-data` volume still exists and the CLI output names it along with the cleanup command

#### Scenario: Cache reused on re-creation

- **WHEN** the sandbox is re-created for the same project after removal
- **THEN** the same volume is mounted again and previously pulled images are still present

### Requirement: Manual daemon startup helper

The image SHALL provide `/usr/local/bin/docker-up`. The helper SHALL be idempotent (no-op success when the daemon already answers `docker info`), SHALL start `dockerd` in the background with output logged to `/tmp/dockerd.log`, SHALL wait up to 60 seconds for readiness, and SHALL exit non-zero with the log contents on failure. When `/var/lib/docker` is overlay-backed (no data volume mounted), the helper SHALL fail with an actionable error pointing to the `docker.enabled` project config option.

#### Scenario: First start succeeds

- **WHEN** `docker-up` runs in a docker-enabled sandbox with no daemon running
- **THEN** it starts `dockerd`, waits for readiness, and `docker info` succeeds afterwards

#### Scenario: Repeated start is a no-op

- **WHEN** `docker-up` runs while the daemon is already running
- **THEN** it exits successfully without starting a second daemon

#### Scenario: Missing data volume produces actionable error

- **WHEN** `docker-up` runs in a sandbox where `/var/lib/docker` is overlay-backed
- **THEN** it exits non-zero with a message telling the user to set `docker.enabled: true` in the project config

### Requirement: Registry access through the network policy

Documentation SHALL state the egress allow-rules required to pull images (Docker Hub: `auth.docker.io:tcp:443`, `registry-1.docker.io:tcp:443`, and the blob CDN `production.cloudfront.docker.com:tcp:443`; `production.cloudflare.docker.com:tcp:443` is the legacy CDN variant). With those rules present, pulls SHALL succeed through the deny-by-default policy. Without them, registry access SHALL remain blocked.

#### Scenario: Pull with allow rules succeeds

- **WHEN** a docker-enabled project includes the Docker Hub allow rules and the user runs `docker pull hello-world`
- **THEN** the image is pulled and `docker run --rm hello-world` succeeds

#### Scenario: Registry blocked without allow rules

- **WHEN** a project has no registry allow rules and the user attempts `docker pull`
- **THEN** the pull fails because egress is denied by the network policy
