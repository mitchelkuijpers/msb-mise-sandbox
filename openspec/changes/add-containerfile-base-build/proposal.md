## Why

The current OCI workflow can only layer project tools onto a registry image selected by `build.from`, which prevents users from adding arbitrary system packages and base-image customization that `mise oci build` cannot express. Users should be able to maintain a personal Containerfile locally without publishing its image to an external registry.

## What Changes

- Recognize an optional personal base definition at `~/.config/mise-msb/image/Containerfile`, using its containing directory as the isolated build context.
- When the personal Containerfile exists, build it locally and expose the resulting base to `mise oci build` through a temporary loopback OCI registry that is never published externally.
- Let Linux builds consume the temporary base through `localhost` and macOS Linux-builder VMs consume it through `host.microsandbox.internal` with narrowly scoped host network access.
- Require the Linux mise process executing `mise oci build` to be version `2026.7.12` or newer when the custom-base path needs non-loopback insecure-registry support.
- Preserve the existing `build.from` pipeline unchanged when no personal Containerfile exists.
- Include custom-base stages in print mode, diagnostics, cleanup behavior, tests, and documentation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mise-oci-image`: Add optional local Containerfile base construction, temporary local-registry handoff, platform-specific base resolution, and Linux mise version validation while retaining the existing registry-base fallback.

## Impact

- Affects the OCI build orchestrator, build command output, subprocess planning, and failure cleanup.
- Adds an optional Docker-compatible Containerfile builder dependency only when the personal Containerfile is present, plus a locally run OCI registry for the duration of that build.
- Adds host-network access to the macOS builder VM only for the temporary registry port.
- Changes the current `mise-oci-image` requirement that the workflow does not use a Containerfile or require Docker; the default path remains Docker-free.
- Requires documentation for the personal image directory, build context boundaries, local-only registry behavior, and minimum Linux mise version.
