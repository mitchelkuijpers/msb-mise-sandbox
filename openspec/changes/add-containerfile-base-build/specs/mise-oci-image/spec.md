## MODIFIED Requirements

### Requirement: Mise is the image builder

The build workflow SHALL invoke experimental `mise oci build` against the project's `mise.toml` to create the final OCI layout, and the wrapper SHALL NOT implement image layers itself. When no personal Containerfile exists, the workflow SHALL NOT require Docker and SHALL pass configured `build.from` as the base reference. When a personal Containerfile exists, the workflow SHALL use its locally built image as the effective base reference. In both cases the workflow SHALL pass the local image tag with `--tag` and an explicit OCI layout output directory with `--output`.

#### Scenario: Project build invokes mise OCI
- **WHEN** no personal Containerfile exists and project config selects base `ubuntu:24.04` and tag `my-project:dev`
- **THEN** the build invokes `MISE_EXPERIMENTAL=1 mise oci build --from ubuntu:24.04 --tag my-project:dev --output <layout>` from the project root without invoking Docker

#### Scenario: Custom base still uses mise for the final image
- **WHEN** a personal Containerfile exists and its local base image is available to the Linux builder
- **THEN** the build invokes `mise oci build` with that local image as `--from` and layers the project's `mise.toml` tools onto it

### Requirement: Build output and failures are transparent

The CLI SHALL stream Containerfile-build, temporary-registry, Linux-builder, mise, tar, and image-load output for every stage that applies and SHALL return the first failing command's exit status. Errors SHALL identify the failed stage, preserve OCI diagnostics when available, and include copyable commands obtainable through print mode. Print mode for a custom-base build SHALL show the planned Containerfile build, local registry handoff, platform-specific mise build, archive, image-load, and cleanup stages without executing them.

#### Scenario: Mise installation failure is propagated
- **WHEN** a tool declared in `mise.toml` cannot be installed
- **THEN** the build exits non-zero and identifies `mise oci build` as the failed stage

#### Scenario: Containerfile failure is propagated
- **WHEN** Docker cannot build the personal Containerfile
- **THEN** the build exits with Docker's non-zero status, identifies the Containerfile build stage, and does not invoke `mise oci build`

#### Scenario: Custom build can be inspected
- **WHEN** a user runs `mise-msb build --print` and the personal Containerfile exists
- **THEN** the output shows all custom-base and final-image commands in execution order with placeholders for runtime-allocated names and ports

## ADDED Requirements

### Requirement: Optional personal Containerfile base

The build workflow SHALL detect `~/.config/mise-msb/image/Containerfile` as an optional personal base definition. Its containing `~/.config/mise-msb/image` directory SHALL be the Docker build context so files outside that dedicated directory are not sent to the builder. The personal Containerfile SHALL take precedence over configured `build.from` only for selecting the base of the current build; `build.from` SHALL remain the effective base when the file is absent.

#### Scenario: Personal Containerfile is discovered
- **WHEN** `~/.config/mise-msb/image/Containerfile` exists
- **THEN** `mise-msb build` invokes Docker with that file and `~/.config/mise-msb/image` as its build context

#### Scenario: Personal Containerfile is absent
- **WHEN** `~/.config/mise-msb/image/Containerfile` does not exist
- **THEN** `mise-msb build` follows the existing Docker-free workflow using configured `build.from`

#### Scenario: Personal configuration is outside the build context
- **WHEN** Docker builds the personal Containerfile
- **THEN** `~/.config/mise-msb/config.toml` and other siblings of the `image` directory are not part of the Docker build context

### Requirement: Local-only registry handoff

For a personal Containerfile build, the wrapper SHALL start a temporary unauthenticated OCI registry bound only to a dynamically allocated host loopback port, tag and push the custom base only to that registry, and remove the registry after the build attempt. The wrapper SHALL NOT push the custom base or final image to an external registry. It SHALL use `localhost:<port>` as the base registry on Linux and `host.microsandbox.internal:<port>` inside a macOS Linux-builder VM.

#### Scenario: Linux consumes the local base
- **WHEN** a custom-base build runs directly on Linux
- **THEN** Docker pushes the base to a loopback-only temporary registry and `mise oci build --from` reads it through `localhost:<port>`

#### Scenario: macOS builder consumes the host base
- **WHEN** a custom-base build runs on macOS
- **THEN** the Linux builder receives `host.microsandbox.internal:<port>` as the base registry, marks that registry as insecure for mise, and receives network permission limited to the host registry TCP port

#### Scenario: Registry remains local
- **WHEN** the custom base is transferred to the temporary registry
- **THEN** the registry listens only on host loopback and no external registry credentials or pushes are used

#### Scenario: Registry is cleaned after failure
- **WHEN** any stage after registry startup succeeds or fails
- **THEN** the wrapper attempts to stop and remove the temporary registry without replacing the original stage's exit status

### Requirement: Compatible Linux mise version

When the personal Containerfile path is active, the wrapper SHALL verify that the Linux mise process which will execute `mise oci build` is version `2026.7.12` or newer before building the custom base. On Linux this SHALL validate the host mise binary; on macOS this SHALL validate mise inside the configured Linux builder image without imposing a version requirement on host macOS mise.

#### Scenario: Compatible Linux host mise
- **WHEN** a custom-base build runs on Linux with mise `2026.7.12` or newer
- **THEN** the version check succeeds and the custom-base pipeline may continue

#### Scenario: Outdated Linux host mise
- **WHEN** a custom-base build runs on Linux with mise older than `2026.7.12`
- **THEN** the build fails before Docker or the temporary registry starts and reports the detected and required versions

#### Scenario: Compatible macOS builder mise
- **WHEN** a custom-base build runs on macOS and the configured Linux builder contains mise `2026.7.12` or newer
- **THEN** the builder version check succeeds without inspecting or constraining host macOS mise

#### Scenario: Outdated macOS builder mise
- **WHEN** the configured Linux builder contains mise older than `2026.7.12`
- **THEN** the build fails before Docker or the temporary registry starts and identifies `build.builderImage` as the component requiring an update
