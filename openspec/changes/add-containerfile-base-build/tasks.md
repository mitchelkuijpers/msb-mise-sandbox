## 1. Custom Base Discovery and Preflight

- [x] 1.1 Add discovery for `~/.config/mise-msb/image/Containerfile` and resolve its containing directory as the fixed Docker build context.
- [x] 1.2 Add calendar-version parsing and comparison for the minimum Linux mise version `2026.7.12`, preserving raw version output in parse and compatibility errors.
- [x] 1.3 Add platform-specific custom-base preflight: inspect host mise on Linux, inspect `build.builderImage` mise on macOS, ignore host macOS mise, and require Docker only when the personal Containerfile exists.

## 2. OCI Pipeline Boundaries

- [x] 2.1 Refactor OCI layout production from the shared tar and `msb image load` stages so each build executes `mise oci build` exactly once.
- [x] 2.2 Preserve the existing direct Linux and macOS builder behavior, configured `build.from`, output retention, and exit-code propagation when no personal Containerfile exists.
- [x] 2.3 Define custom-base build state that carries unique runtime identifiers, the effective platform-specific base reference, and cleanup responsibility through the pipeline.

## 3. Local Containerfile Base Handoff

- [x] 3.1 Implement a uniquely named temporary `registry:2` container with port 5000 published to a dynamically allocated `127.0.0.1` host port, including robust `docker port` output parsing.
- [x] 3.2 Build `~/.config/mise-msb/image/Containerfile` with its isolated image-directory context, assign a unique local registry tag, and push it only to the temporary registry.
- [x] 3.3 Use `localhost:<port>` for direct Linux mise builds and `host.microsandbox.internal:<port>` for macOS Linux-builder builds.
- [x] 3.4 Configure macOS builders with `MISE_OCI_INSECURE_REGISTRIES` and an `msb` host network allow rule scoped to the temporary registry TCP port.
- [x] 3.5 Remove the temporary registry after success or failure, preserving the primary stage exit status and surfacing cleanup failure according to the design.

## 4. Transparency and Diagnostics

- [x] 4.1 Extend `mise-msb build --print` to render custom-base preflight, Docker build, temporary registry, local push, platform-specific mise, archive, load, and cleanup commands in order using stable placeholders for allocated values.
- [x] 4.2 Add stage-specific labels and actionable failures for version checks, missing Docker, registry startup and port discovery, Containerfile build, local push, mise build, archive, image load, and cleanup.
- [x] 4.3 Ensure successful custom builds remove temporary OCI output while failed layout or import stages preserve the existing diagnostic artifacts and reported paths.

## 5. Automated Verification

- [x] 5.1 Add unit tests for personal Containerfile discovery, isolated context selection, version parsing, the `2026.7.12` boundary, and malformed version output.
- [x] 5.2 Add fake-binary Linux pipeline tests covering custom-base success, Containerfile failure, local push failure, old mise rejection before Docker, registry cleanup, and the unchanged no-Containerfile fallback.
- [x] 5.3 Add macOS plan tests covering builder-only mise validation, host macOS mise independence, `host.microsandbox.internal`, insecure-registry configuration, and port-scoped host network access.
- [x] 5.4 Add print-mode tests proving no subprocess mutation occurs and all custom stages appear with deterministic placeholders.
- [x] 5.5 Run the complete Bun test suite and TypeScript check, then perform an opt-in real Docker/msb smoke build when the required local runtimes are available.

## 6. Documentation

- [x] 6.1 Document the personal image directory layout, trusted-code implications, Docker opt-in dependency, `.dockerignore` support, and an example base-only Containerfile.
- [x] 6.2 Update build-flow and architecture diagrams for the loopback registry handoff on Linux and `host.microsandbox.internal` handoff on macOS.
- [x] 6.3 Document local-only registry guarantees, automatic cleanup, the Linux mise `>=2026.7.12` requirement, print-mode output, and fallback behavior when the Containerfile is absent.
