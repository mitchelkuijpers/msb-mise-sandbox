## Why

Agents working in the sandbox regularly need to build and run containers — project dependencies (databases, caches, services), `docker compose` workflows, and image builds. The sandbox image has no Docker tooling, so these workflows are impossible without breaking microVM isolation (e.g., mounting the host Docker socket, which we explicitly reject). microsandbox officially supports this pattern via its [Docker-in-sandbox recipe](https://docs.microsandbox.dev/recipes/docker/docker-in-sandbox): a full microVM with its own kernel can run a real `dockerd`, and a disk-backed named volume at `/var/lib/docker` solves the overlay-on-overlay storage problem. This change makes that pattern a first-class, per-project capability of our custom image.

## What Changes

- Install Docker CE (`docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`) into the sandbox OCI image from Docker's official apt repository. The daemon is never started at build time.
- Add a `/usr/local/bin/docker-up` helper script (from `scripts/docker-up.sh`) that starts `dockerd` manually per boot and waits for readiness. The microVM has no systemd or entrypoint, so daemon startup is an explicit, on-demand action.
- Add an optional per-project `docker` config section (`enabled`, `dataVolumeSize`, default `"10G"`). When enabled, sandbox creation mounts a disk-backed named volume `<project>-docker-data` at `/var/lib/docker` using the SDK's `namedWith(..., "ensure-exists", "disk", sizeMib)` mount. This volume is **required** for `dockerd` to run (the sandbox rootfs is overlay-backed and overlay2 cannot stack on it) and it persists across sandbox removal, preserving image and build cache. Docker support requires the stock `agent-sandbox` image — creation fails fast with an actionable error for custom images — and `dataVolumeSize` is validated at registry load (uppercase `M`/`G` suffix, minimum 1024 MiB).
- `project add` gains an "Enable Docker support?" prompt.
- `remove` prints a note when a `<project>-docker-data` volume is preserved, with the `msb volume rm` command to delete it.
- Extend `tests/smoke-test.sh` with Docker coverage: `docker-up` readiness, `docker info`, and `docker run --rm hello-world` (pull skippable via `SKIP_DOCKER_PULL=1`).
- Document the feature in `README.md`, `docs/usage.md` (config schema + registry egress rules), `docs/security.md` (nested-container security notes), and `docs/architecture.md` (image contents, volume rationale, daemon lifecycle).

## Capabilities

### New Capabilities

- `sandbox-docker`: Docker engine inside the microVM — Docker CE packages in the image, per-project enablement via config, required disk-backed data volume at `/var/lib/docker`, manual `docker-up` daemon startup, and the registry egress allow-rules needed to pull images through the deny-by-default network policy.

### Modified Capabilities

None — no canonical specs exist in `openspec/specs/` yet.

## Impact

- **Modified**: `Containerfile` (Docker apt repo + packages + helper script + build-time binary checks), `src/types.ts` (`DockerConfig` type + defaults), `src/lib/config.ts` (`docker` section validation), `src/lib/sandbox.ts` (conditional named disk volume mount + stock-image guard), `src/commands/project-add.ts` (new prompt), `src/commands/remove.ts` (volume-preserved note), `tests/smoke-test.sh` (Docker steps + updated piped answers + `jq` prerequisite check), `README.md`, `docs/usage.md`, `docs/security.md`, `docs/architecture.md`.
- **New**: `scripts/docker-up.sh`, unit tests for the new config section.
- **Dependencies**: Docker CE packages from `download.docker.com` (build-time only); microsandbox TS SDK named-volume mount API (`namedWith` with `"ensure-exists"`/`"disk"`/`sizeMib`), already present in the pinned SDK.
- **Resources**: image grows by the Docker CE package footprint; each docker-enabled project gets a named disk volume (default 10G capacity); running containers share the sandbox's CPU/memory limits, so docs recommend raising `resources.memory` for large builds.
- **Out of scope**: auto-starting `dockerd` on create/start, the legacy `compose.yaml` alternative interface, host Docker socket mounting.
