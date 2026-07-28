## Why

The current per-project `mise oci` workflow makes a usable development sandbox expensive and fragile to build, especially on macOS, while every developer still has to assemble Docker persistence, personal tools, and local configuration manually. A locally built stock runtime plus runtime mise provisioning can make normal sandbox use fast and repeatable without publishing a personalized image or putting developer-specific configuration in project repositories.

## What Changes

- Add an explicit `mise-msb setup` workflow that locally builds and loads a versioned Ubuntu stock image containing pinned mise, Docker CE, common development prerequisites, and an idempotent Docker startup helper.
- Make the stock image the default runtime so projects do not need a project-specific image build before `create`, `run`, or `shell`.
- Automatically provision per-project directory-backed mise state and disk-backed Docker data volumes for stock-image sandboxes, preserving both independently of sandbox removal.
- Bootstrap project tools inside the Linux sandbox, using `mise install --locked` when `mise.lock` exists and ordinary `mise install` otherwise.
- Discover one user-owned full-bootstrap definition at `~/.config/mise-msb/bootstrap/mise.toml`, expose it as mise's global config, and apply its tools, packages, dotfiles, and hooks separately from project configuration.
- Re-run personal bootstrap when a sandbox is new or the personal bootstrap content changes, while avoiding unchanged warm-start work.
- Continue using personal `~/.config/mise-msb/config.toml` mounts for explicit per-person host configuration, including narrowly scoped credential-bearing mounts; never discover or mount host credentials implicitly.
- Remove `mise-msb build`, the experimental `mise oci` workflow, `[build]` configuration, personal Containerfile discovery, the macOS builder VM, temporary registry/skopeo handoff, OCI layout archiving, and their dedicated tests and documentation.
- Allow advanced users to select a custom image reference that they build and load outside `mise-msb`; custom images retain generic lifecycle behavior and own all compatibility requirements.
- **BREAKING**: Change the default image from the derived `<project-name>:dev` image to the versioned local stock image, remove wrapper-managed project image builds, and make stock-image lifecycle operations wrapper-managed for Docker and bootstrap.

## Capabilities

### New Capabilities
- `stock-sandbox-image`: Local setup, versioning, loading, and default selection of the Ubuntu stock runtime image.
- `personal-sandbox-bootstrap`: Discovery and execution of per-person mise bootstrap configuration, personal tool layering, change detection, and explicit host configuration mounts.

### Modified Capabilities
- `mise-oci-image`: Retire the capability and remove all wrapper-managed experimental OCI project-image requirements.
- `sandbox-docker`: Stock-image sandboxes receive wrapper-managed Docker installation, startup, readiness, and persistent data storage by default.
- `sandbox-wrapper-cli`: Add `setup` and lifecycle bootstrap stages while preserving deterministic, printable subprocess execution.
- `layered-sandbox-config`: Default image selection and derived per-project state are added alongside the existing personal and project configuration layers.

## Impact

- Affects image setup/build orchestration, config defaults and validation, sandbox argv generation, lifecycle planning, volume naming, bootstrap subprocesses, print mode, removal output, and documentation.
- Adds a repository-owned stock-image Containerfile and deletes the project-image builder VM, loopback registry, skopeo handoff, personal Containerfile workflow, and experimental mise OCI orchestration; useful direct Docker build/save/load code from `add-containerfile-base-build` can be reused for stock setup.
- Requires host Docker for the explicit local `setup` operation and network access for the initial Ubuntu, Docker package, mise, and tool downloads; no project-owned external image registry is introduced.
- Creates persistent `<project>-mise-v1` directory volumes and `<project>-docker-data` disk volumes, which require documented inspection and cleanup behavior.
- Personal bootstrap and writable host mounts execute as trusted operator-owned configuration. Project code can read mounted credentials, and writable mounts can modify host files, so mounts remain explicit and narrowly scoped.
- Existing users of `mise-msb build` must migrate to stock mode or build and load a custom image with external tooling before selecting its explicit image reference.
