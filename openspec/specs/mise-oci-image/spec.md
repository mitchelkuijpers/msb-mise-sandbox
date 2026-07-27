# mise-oci-image Specification

## Purpose
TBD - created by archiving change add-lean-mise-msb-wrapper. Update Purpose after archive.
## Requirements
### Requirement: Mise is the image builder

The build workflow SHALL invoke experimental `mise oci build` against the project's `mise.toml`; the wrapper SHALL NOT implement image layers itself and SHALL NOT require Docker or a Containerfile. The workflow SHALL pass the configured base reference with `--from`, local image tag with `--tag`, and an explicit OCI layout output directory with `--output`.

#### Scenario: Project build invokes mise OCI
- **WHEN** the project config selects base `ubuntu:24.04` and tag `my-project:dev`
- **THEN** the build invokes `MISE_EXPERIMENTAL=1 mise oci build --from ubuntu:24.04 --tag my-project:dev --output <layout>` from the project root

### Requirement: Build executes on Linux

Because mise embeds host-native binaries, the CLI SHALL run `mise oci build` directly when the host is Linux and SHALL automatically run the same command in a configured Linux builder image through `msb run` when the host is macOS. The macOS builder SHALL mount the project read-only and a temporary host output directory read-write. Unsupported host operating systems SHALL fail with an actionable error.

#### Scenario: Linux host builds directly
- **WHEN** `mise-msb build` runs on Linux
- **THEN** the CLI executes `mise oci build` directly on the host

#### Scenario: macOS host builds through msb
- **WHEN** `mise-msb build` runs on macOS
- **THEN** the CLI starts the configured Linux builder with `msb run`, mounts the project read-only, and writes the OCI layout through the output mount

#### Scenario: macOS never embeds host-native tools
- **WHEN** a macOS user builds a sandbox image
- **THEN** no host-side `mise oci build` command is executed

### Requirement: Configurable build inputs

The merged configuration SHALL support `build.from`, `build.tag`, and `build.builderImage`. `build.from` SHALL default to a glibc-based Debian or Ubuntu image, `build.tag` SHALL default to `<project-name>:dev`, and `build.builderImage` SHALL identify a Linux image containing a mise version with OCI support. Project tool and bootstrap declarations SHALL remain in `mise.toml`, not be duplicated in `.sandbox.toml`.

#### Scenario: Project overrides personal base
- **WHEN** personal defaults select one base and the project selects another with `build.from`
- **THEN** the project base is passed to `mise oci build --from`

### Requirement: OCI layout import

After a successful build, the CLI SHALL archive the OCI Image Layout without changing its contents and invoke `msb image load --input <archive> --tag <tag>`. It SHALL propagate a non-zero archive or import exit status. Successful builds SHALL print the loaded tag and SHALL remove temporary output unless retention was explicitly requested; failed imports SHALL preserve the archive and print its path.

#### Scenario: Successful layout is loaded
- **WHEN** `mise oci build` produces a valid layout
- **THEN** the wrapper archives it, loads it with `msb image load --input ... --tag ...`, and reports the configured tag

#### Scenario: Import failure preserves diagnostics
- **WHEN** `msb image load` fails
- **THEN** the wrapper exits non-zero and reports the preserved archive path

### Requirement: Build output and failures are transparent

The CLI SHALL stream builder, mise, tar, and image-load output to the terminal and SHALL return the first failing command's exit status. Errors SHALL identify the failed stage and include a copyable command obtainable through print mode.

#### Scenario: Mise installation failure is propagated
- **WHEN** a tool declared in `mise.toml` cannot be installed
- **THEN** the build exits non-zero and identifies `mise oci build` as the failed stage

