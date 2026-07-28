## Context

The wrapper currently runs `mise oci build --from <build.from>` directly on Linux or in an `msb run` Linux builder on macOS, archives the resulting OCI layout, and imports it with `msb image load`. This preserves per-tool mise layers but limits base customization to an already published registry image.

Mise does not accept Containerfiles, local Docker image-store references, or local OCI layouts through `--from`; it resolves bases through an OCI Distribution registry. Microsandbox can run locally built images after `docker save | msb image load`, but its image cache is not a registry that a process inside a builder VM can pull from. A local registry is therefore required to compose a Containerfile-built base with mise's OCI layers.

Current mise releases support non-loopback HTTP registries through `oci.insecure_registries`, introduced in mise `2026.7.12`. This matters on macOS because the Linux builder addresses a host registry through `host.microsandbox.internal`, while a direct Linux build can use loopback `localhost`.

The feature is personal and opt-in. The Containerfile and all files it may copy live under a dedicated personal image directory rather than in individual projects or beside the personal TOML file.

## Goals / Non-Goals

**Goals:**

- Allow arbitrary personal base-image customization through `~/.config/mise-msb/image/Containerfile`.
- Keep project tool versions and final tool layers owned by the project's `mise.toml` and `mise oci build`.
- Keep the custom base entirely local; no GHCR or other external registry push is required.
- Preserve the current Docker-free `build.from` workflow when the personal Containerfile is absent.
- Make Linux and macOS behavior transparent through print mode, stage-specific errors, and deterministic cleanup.
- Validate only the Linux mise binary that executes a custom-base OCI build, requiring version `2026.7.12` or newer.

**Non-Goals:**

- Supporting project-local Containerfiles or arbitrary Containerfile paths in `.sandbox.toml`.
- Supporting Podman, Buildah, or automatic container-engine selection in the first version.
- Teaching mise to read a local OCI layout or implementing OCI layer composition in the wrapper.
- Publishing, retaining, or sharing the personal base through an external registry.
- Managing upgrades of host macOS mise.
- Persisting a local registry service between builds.

## Decisions

### D1: Convention-based personal image directory

**Choice:** Detect `~/.config/mise-msb/image/Containerfile` without adding a new TOML field. Pass `~/.config/mise-msb/image` as the complete Docker build context.

**Why:** The requested base is personal rather than project-specific, and a fixed convention keeps configuration and merge semantics unchanged. A dedicated subdirectory prevents `~/.config/mise-msb/config.toml` and unrelated user configuration from being sent to the Docker daemon. Docker's normal `.dockerignore` handling remains available within the image directory.

**Alternatives considered:**

- Put `Containerfile` directly in `~/.config/mise-msb`: rejected because the containing directory would expose `config.toml` and other personal files to the build context.
- Add `build.containerfile` and `build.context`: deferred because layered configuration would also need explicit reset/disable semantics and project-relative path provenance.
- Use a project-local Containerfile: rejected for this change because the requested base is a reusable personal default.

### D2: Presence selects custom-base mode; absence preserves current behavior

**Choice:** The personal Containerfile activates the local custom-base pipeline. If it does not exist, `build.from` continues to be passed directly to mise with no Docker or registry checks.

**Why:** This is additive for existing users and makes opting in and out a filesystem operation. It also avoids imposing Docker or a newer mise on projects that use the existing registry-base path.

**Alternatives considered:**

- Require an explicit mode setting: clearer in a more general multi-source model, but unnecessary while there is exactly one conventional optional file.
- Always generate a default Containerfile: rejected because it would turn Docker into a mandatory dependency and duplicate the stock `build.from` path.

### D3: Docker is the optional Containerfile engine

**Choice:** When custom-base mode is active, require the `docker` CLI and use `docker build`, `docker run`, `docker port`, `docker push`, and `docker rm -f`. Fail before mutation if Docker is unavailable.

**Why:** The Microsandbox local-image recipe documents this workflow, Docker supports a file named `Containerfile` through `--file`, and choosing one engine keeps command planning and failure behavior small and testable. Docker is required only by users who create the personal Containerfile.

**Alternatives considered:**

- Auto-detect Docker or Podman: broader compatibility but introduces divergent port-discovery, registry, archive, and error behavior.
- Build the final image entirely with Docker and load it into msb: simpler transfer, but loses mise's per-tool OCI layers and changes `mise.toml` from the final image source of truth.

### D4: Temporary loopback registry as a transport bridge

**Choice:** After the version preflight, start a uniquely named `registry:2` container with container port 5000 published to a dynamically allocated host port bound to `127.0.0.1`. Discover the assigned port with `docker port`, build and tag the personal base for that registry under a unique per-build tag, then `docker push` it locally.

**Why:** Mise only accepts registry references as bases. A dynamic port avoids conflicts with AirPlay, developer registries, and parallel builds; a unique container name and image tag isolate concurrent invocations. Binding to loopback ensures the unauthenticated registry is not exposed to the LAN. The registry exists only as a transport between local processes and is removed after the build.

**Alternatives considered:**

- Fixed `localhost:5050`: follows the recipe but can collide with an existing service and makes parallel builds unsafe.
- Persistent local registry: improves repeated transfer caching but creates daemon lifecycle and stale-state management beyond this wrapper's stateless model.
- `docker save | msb image load`: loads into the msb cache but does not provide a registry endpoint to `mise oci build`.
- Remote registry: rejected because the user explicitly wants no external push.

### D5: Platform-specific references to the same local registry

**Choice:** A direct Linux build uses `localhost:<port>/mise-msb/base:<build-id>`. A macOS Linux-builder VM uses `host.microsandbox.internal:<port>/mise-msb/base:<build-id>`, receives `MISE_OCI_INSECURE_REGISTRIES=host.microsandbox.internal:<port>`, and receives an `msb` network rule limited to host TCP port `<port>`.

**Why:** `localhost` inside a microVM refers to the guest, not the macOS host. Microsandbox provides `host.microsandbox.internal` specifically for host access. Mise must be told to use HTTP for that non-loopback registry name, while localhost is insecure by convention. Port-scoped host access avoids broadening the builder's network access more than necessary.

**Alternatives considered:**

- Bind the registry to all host interfaces: rejected because it unnecessarily exposes an unauthenticated registry.
- Configure TLS for the temporary registry: secure but adds certificate generation, trust injection, and cleanup for a loopback-only, short-lived transport.

### D6: Validate the executing Linux mise before Docker starts

**Choice:** Custom-base mode requires mise `>=2026.7.12`. On Linux, run and parse host `mise --version`. On macOS, run a preflight command in `build.builderImage` to inspect its Linux mise. Do not inspect or constrain host macOS mise. Complete this preflight before starting the registry or invoking `docker build`.

**Why:** Only the Linux process executing `mise oci build` needs OCI support and the insecure-registry setting. Early validation avoids spending time building a base that the selected builder cannot consume and produces a targeted error naming the detected version and `build.builderImage` when relevant.

**Alternatives considered:**

- Require the host mise version on every platform: rejected because macOS host mise never executes the OCI build.
- Let an old builder fail during the pull: rejected because the resulting HTTPS or unknown-setting errors are indirect and occur after mutable Docker stages.
- Enforce the minimum on the existing non-Containerfile path: rejected to preserve existing behavior for users who do not opt in.

### D7: Separate layout production from archive and import

**Choice:** Refactor the build orchestrator into a platform-specific layout-production stage followed by shared archive and `msb image load` stages. The Linux or macOS builder SHALL invoke `mise oci build` exactly once. Custom-base preparation supplies only the effective `--from` reference and temporary resources.

**Why:** The current code combines mise execution, archive, and import, while the macOS command separately invokes a builder before re-entering that combined function. A clean stage boundary is necessary to add preflight and local-registry lifetime management without accidentally rebuilding or archiving an incomplete layout.

**Alternatives considered:**

- Add custom-base branches around the current functions: smaller initial diff but duplicates orchestration and makes cleanup/error propagation fragile.

### D8: Cleanup preserves the primary result

**Choice:** Track whether the temporary registry started and remove it in a `finally`-style cleanup path with `docker rm -f`. Cleanup runs after success or failure. A cleanup failure is reported as a warning when an earlier stage already failed and becomes the build failure only when all primary stages succeeded. Successful builds continue to remove temporary OCI output; failed layout/import stages preserve diagnostics according to the existing contract.

**Why:** A failed build must not leave a running registry, but cleanup must not hide the actionable failure that caused the build to stop.

**Alternatives considered:**

- Rely only on Docker `--rm`: it removes the container after the registry process exits but does not stop a still-running registry when the wrapper or a later command fails normally.

## Risks / Trade-offs

- **[Docker becomes an opt-in dependency]** -> Probe `docker` only when the personal Containerfile exists and preserve the Docker-free fallback.
- **[`registry:2` may need an initial pull]** -> Stream Docker output and identify registry startup as its own stage; subsequent builds use Docker's local cache.
- **[Host gateway behavior differs across Microsandbox versions]** -> Use the documented `host.microsandbox.internal` endpoint and cover the macOS plan plus an end-to-end smoke test on the supported `msb` version.
- **[Unauthenticated local registry could be modified by another local process]** -> Bind only to loopback, use an unpredictable per-build repository tag, keep the lifetime short, and never accept a user-supplied external destination.
- **[Parallel builds share Docker but not registry state]** -> Allocate unique container names, dynamic ports, tags, and output directories.
- **[Version output formats can vary]** -> Parse the leading calendar version conservatively and fail with the raw detected output when it cannot be interpreted.
- **[Containerfile commands are trusted code with Docker-daemon authority]** -> Treat the personal image directory as operator-owned configuration and document that this feature is not safe for untrusted project Containerfiles.
- **[Print mode cannot know runtime-assigned ports]** -> Render stable placeholders such as `<registry-name>`, `<registry-port>`, and `<build-id>` while preserving command order and argument structure.

## Migration Plan

1. Add discovery and custom-base planning without changing configuration files or defaults.
2. Refactor OCI layout production from archive/import and retain existing tests for the no-Containerfile path.
3. Add Linux and macOS version preflights, Docker registry orchestration, platform-specific base references, and cleanup.
4. Extend print mode and stage diagnostics.
5. Add unit/integration tests with fake binaries plus an optional real Docker/msb smoke test.
6. Document the personal image directory and opt-in dependency.

No data or configuration migration is required. Existing users remain on `build.from` unless they create the conventional Containerfile. To roll back or disable the feature, remove or rename `~/.config/mise-msb/image/Containerfile`; the next build uses the existing path. A code rollback leaves no persistent registry state by design.

## Open Questions

None. Podman support, project-local Containerfiles, persistent registry caching, and configurable paths are explicit follow-up opportunities rather than blockers for this change.
