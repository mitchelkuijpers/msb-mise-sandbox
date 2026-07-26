## Context

The agent sandbox boots a custom OCI image (Ubuntu 24.04 + mise-managed tools, `Containerfile`) inside a microsandbox microVM. The image has no entrypoint and no init system — the microsandbox runtime boots it directly and the CLI drives everything through the SDK/`msb`. Egress is deny-by-default with TLS-intercepting secret substitution at the boundary. Per-project configuration lives in `~/.agent-sandbox/projects.json` and is applied by `src/lib/sandbox.ts` at create time.

microsandbox documents an official [Docker-in-sandbox recipe](https://docs.microsandbox.dev/recipes/docker/docker-in-sandbox): `dockerd` runs fine inside the microVM, and a **disk-backed named volume** at `/var/lib/docker` is required because the sandbox rootfs is overlay-backed and Docker's default overlay2 storage driver cannot stack on overlayfs. The recipe's start pattern is plain `dockerd &` plus a bounded wait-for-`docker info` loop. The TS SDK exposes this natively: `sb.volume("/var/lib/docker", (v) => v.namedWith(name, "ensure-exists", "disk", sizeMib))` creates-or-reuses the volume idempotently at mount time.

## Goals / Non-Goals

**Goals:**

- Full Docker CE engine (dockerd, CLI, buildx, compose v2) available inside the microVM, baked into the custom image.
- Per-project opt-in via `docker.enabled` in the project registry; enabled projects get a persistent, disk-backed `<project>-docker-data` volume mounted at `/var/lib/docker`.
- Manual, idempotent daemon startup via `/usr/local/bin/docker-up` (no init system exists).
- Documented registry egress rules so `docker pull` works through the deny-by-default policy.
- Smoke-test coverage proving the daemon starts and runs a container inside the microVM.

**Non-Goals:**

- Auto-starting `dockerd` on sandbox create/start (possible follow-up change).
- The legacy `compose.yaml` alternative interface (nested Docker there would require privileges; left untouched).
- Mounting the host Docker socket (violates the isolation model; explicitly rejected).
- Switching the base image to `docker:dind` (we keep our Ubuntu 24.04 + mise image).

## Decisions

### 1. Docker CE from the official apt repository

Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin` plus `iptables` (dockerd's firewall backend) from `download.docker.com` (ASCII-armored GPG key in `/etc/apt/keyrings/docker.asc` with `signed-by` — works without gnupg/dearmor, confirmed by the spike; `noble` repo).

- **Why**: current upstream releases, buildx/compose as first-class plugins, matches the `docker:dind` lineage the official recipe validates.
- **Alternative considered**: Ubuntu's `docker.io` + `docker-buildx` + `docker-compose-v2` — simpler build, but older versions and distro packaging quirks.

### 2. Manual `docker-up` helper script

Ship `scripts/docker-up.sh` as `/usr/local/bin/docker-up`. Behavior: no-op success if `docker info` already works; otherwise refuse with an actionable error if `/var/lib/docker` is overlay-backed (points the user at `docker.enabled`); else start `dockerd >/tmp/dockerd.log 2>&1 &`, wait up to 60s for readiness, dump the log and exit non-zero on timeout.

- **Why**: the microVM has no systemd/entrypoint; an unused always-on daemon wastes the sandbox's memory/CPU budget; explicit startup keeps `create`/`start` fast and matches the official recipe pattern.
- **Alternative considered**: CLI auto-start on `create`/`start` — convenient but adds lifecycle complexity and always-on overhead; deferred as a follow-up option.

### 3. Required disk-backed named volume, per-project opt-in

`ProjectConfig` gains `docker?: { enabled: boolean; dataVolumeSize?: string }` (default `enabled: false`, size `"10G"`). When enabled, `createSandbox` mounts `<project>-docker-data` at `/var/lib/docker` via `namedWith(..., "ensure-exists", "disk", sizeMib)`.

- **Why required**: overlay2-on-overlayfs is unsupported by the kernel — without the volume, `dockerd` cannot start with its default storage driver. The volume is functional, not just persistence.
- **Why opt-in**: avoids creating a 10G-capacity disk volume for every project regardless of need, and keeps the feature explicit in the registry.
- **Persistence**: named volumes survive `agent-sandbox remove`, so image/build cache survives sandbox re-creation. `remove` prints the preserved volume name and the `msb volume rm <project>-docker-data` cleanup command.
- **Alternative considered**: always-on mount for every project — rejected (surprise disk usage, and meaningless for non-Docker users).

### 4. Registry egress rules documented, not auto-injected

Docker Hub pulls need these hosts in `network.allow` (all `:tcp:443`): `auth.docker.io`, `registry-1.docker.io`, and the blob CDN `production.cloudfront.docker.com` — the spike proved pulls redirect there; `production.cloudflare.docker.com` is documented as the legacy CDN variant. Docs provide a table (Docker Hub, ghcr.io, etc.); users add rules per project. `docker.enabled` does **not** imply network rules.

- **Why**: deny-by-default is a core security property; silently broadening egress for docker-enabled projects would weaken it. The smoke test injects the Hub rules into its own test project to validate the documented path end-to-end.

### 5. Build-time verification of binaries only

The `Containerfile` verification RUN checks `docker --version && dockerd --version && docker buildx version && docker compose version`. The daemon is never started during `docker build` (no usable runtime/cgroups there).

### 6. Docker enablement constrained to the stock image; size grammar validated at load

`docker.enabled: true` requires the stock `agent-sandbox:latest` image (or its `docker.io/library/agent-sandbox:latest` alias): `createSandbox` fails fast with an actionable error before creating the sandbox or volume when a project pairs Docker support with any other OCI image. `dataVolumeSize` is validated at registry load in `validateProjectConfig`: it must match `^[0-9]+[MG]$` (uppercase integer, MiB/GiB) and be at least 1024 MiB, so typos like `10GB`/`10GiB` fail before any sandbox operation.

- **Why fail-fast on the image**: only the stock image carries `dockerd`, the CLI, the plugins, and `docker-up`. A volume-only mount against a custom image would defer failure to an opaque runtime error (`docker-up: command not found`).
- **Alternative considered**: redefine `docker.enabled` as volume-only semantics with documented tooling requirements for custom images — rejected for now (deferred failure, no current use case). A future change can add an explicit opt-in for custom Docker-capable images.
- **Why load-time size validation**: the SDK mount call converts the size to MiB deep inside sandbox creation; surfacing malformed or too-small values at registry load gives a clear, immediate error naming the expected format.

## Spike Findings (2026-07-25, tasks 1.1–1.4)

Validated with a scratch image (`ubuntu:24.04` + Docker CE 29.6.2 from the official apt repo) booted via the TS SDK with `namedWith("spike-docker-data", "ensure-exists", "disk", 10240)` at `/var/lib/docker`:

- **Kernel is capable**: guest kernel 6.12.91 runs `dockerd` with Firewall Backend `iptables` (DOCKER nat chains created), cgroups v2 (`cgroupfs` driver), Network drivers `bridge host ipvlan macvlan null overlay`. Only warning: `No swap limit support` (harmless).
- **Volume mount works as designed**: `/var/lib/docker` appears as `/dev/vdc ext4 rw,relatime` in the guest — disk-backed, not overlay. `docker info` selects storage driver `overlayfs` (Docker 29's name for overlay2) on it.
- **Hub pull works through the policy**: with `auth.docker.io`, `registry-1.docker.io`, and `production.cloudfront.docker.com` allowed (all `:tcp:443`), `docker pull hello-world` + `docker run --rm hello-world` succeed through deny-by-default egress. **Correction**: the live blob CDN is `production.cloudfront.docker.com`, not the `production.cloudflare.docker.com` host from the microsandbox recipe — without it the blob GET fails with `EOF`. Both hosts are documented.
- **Rootfs is ephemeral across stop/start**: `/tmp/dockerd.log` from a previous boot was gone after a stop/start cycle; only named volumes (like `/var/lib/docker`) persist. This reinforces per-boot `docker-up` startup and means pulled images survive only via the data volume.
- **`msb exec` on a stopped sandbox boots a throwaway microVM**: background processes (`dockerd &`) do not survive; daemon startup must target a running sandbox (CLI/agent flows already ensure this).
- **Image build notes**: `.asc` keyring works without dearmor; `iptables` must be installed explicitly (the stock image lacks it; it pulls `nftables` as a dependency). The container-driver buildx builder cannot see dockerd-local images — spike image had to build `FROM docker.io/library/ubuntu:24.04`; not an issue for the real Containerfile which builds `FROM ubuntu:24.04` directly.

## Risks / Trade-offs

- **Guest kernel lacks netfilter/cgroup features for bridge NAT** → resolved by the spike: kernel 6.12.91, iptables firewall backend with DOCKER nat chains, cgroups v2. Smoke test asserts `docker info` + `docker run hello-world` as regression coverage.
- **TLS-intercepting egress proxy interferes with registry pulls** → resolved by the spike: pulls succeed with the documented allow rules; the blob CDN host is `production.cloudfront.docker.com` (corrected from the recipe's cloudflare host).
- **Image size grows** (Docker CE packages, hundreds of MB) → accepted; noted in docs; build time increases slightly.
- **Stale volumes accumulate** after sandbox removal → `remove` prints the preserved volume name + cleanup command; docs cover `msb volume rm`.
- **Running containers share the sandbox CPU/memory limits** → docs recommend raising `resources.memory` for large builds (recipe baseline is 2G; our default is 8G).
- **Nested privileged containers** (`--privileged`, `--network host`) run with full power *inside* the microVM → still bounded by the microVM and its egress policy; documented in `docs/security.md`.

## Migration Plan

1. Land image + CLI + docs changes.
2. Run `agent-sandbox build` to rebuild and reload the image.
3. Existing projects default to `docker.enabled: false` — fully backward compatible, no registry migration needed.
4. To adopt: set `docker.enabled: true` in a project's config (or re-run `project add`), then `agent-sandbox remove` + `create` to pick up the volume mount.
5. Rollback: rebuild the image from the previous commit; disable `docker.enabled`; delete leftover volumes with `msb volume rm`.

## Open Questions

- Should a follow-up change add optional daemon auto-start on `create`/`start` for docker-enabled projects? (Deferred — manual `docker-up` is the contract for now.)
