## 1. Validation Spike (fail fast)

- [x] 1.1 Build a scratch image variant with Docker CE packages and boot a manual test sandbox from it
- [x] 1.2 Inside the test sandbox, start `dockerd` and run `docker info`: confirm the guest kernel supports netfilter/bridge NAT and check which storage driver is selected
- [x] 1.3 Verify `sb.volume("/var/lib/docker", (v) => v.namedWith(name, "ensure-exists", "disk", sizeMib))` mounts a disk-backed volume from the TS SDK (confirm `/var/lib/docker` is not overlay-backed in the guest)
- [x] 1.4 Add Docker Hub allow rules (`auth.docker.io`, `registry-1.docker.io`, `production.cloudfront.docker.com` blob CDN, plus legacy `production.cloudflare.docker.com` — all `:tcp:443`) to the test project's `network.allow` and verify `docker pull hello-world` + `docker run --rm hello-world` work through the deny-by-default egress + TLS-intercepting proxy
- [x] 1.5 Record spike findings in `design.md` (adjust decisions if any assumption failed) before proceeding

## 2. Image Changes

- [x] 2.1 Create `scripts/docker-up.sh`: idempotent (no-op when `docker info` succeeds), refuse with actionable error when `/var/lib/docker` is overlay-backed, otherwise start `dockerd >/tmp/dockerd.log 2>&1 &`, wait up to 60s for readiness, dump log and exit non-zero on timeout
- [x] 2.2 Edit `Containerfile`: add Docker's official apt repo (ASCII-armored GPG key in `/etc/apt/keyrings/docker.asc` with `signed-by`, `noble` repo) and install `iptables docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`
- [x] 2.3 Edit `Containerfile`: `COPY scripts/docker-up.sh /usr/local/bin/docker-up` and make it executable
- [x] 2.4 Edit `Containerfile`: extend the build-time verification RUN with `docker --version && dockerd --version && docker buildx version && docker compose version` (binaries only — never start the daemon at build time)
- [x] 2.5 Run `agent-sandbox build` and verify the image builds and loads into microsandbox

## 3. Config Layer

- [x] 3.1 Add `DockerConfig` (`enabled: boolean`, `dataVolumeSize: string`) to `src/types.ts` and include optional `docker` in `ProjectConfig`
- [x] 3.2 Update `applyDefaults` in `src/types.ts`: default `docker.enabled: false`, `docker.dataVolumeSize: "10G"`
- [x] 3.3 Add `docker` section validation to `validateProjectConfig` in `src/lib/config.ts`: `enabled` must be a boolean; `dataVolumeSize` must match `^[0-9]+[MG]$` and be at least 1024 MiB — reject with `ConfigValidationError` naming the project, the invalid value, and the expected format
- [x] 3.4 Add/extend unit tests in `tests/config.test.ts` covering: absent docker section defaults to disabled, enabled config preserved, custom `dataVolumeSize` honored, invalid sizes rejected (`"10GB"`, `"10GiB"`, `"10g"`, `"512M"` below minimum)

## 4. Sandbox Runtime

- [x] 4.1 Edit `src/lib/sandbox.ts`: add memory-spec parsing reuse for `dataVolumeSize` (convert `"10G"` → MiB via existing `parseMemoryMib`)
- [x] 4.2 Edit `src/lib/sandbox.ts`: when `docker.enabled` is true, mount `<project>-docker-data` at `/var/lib/docker` via `sb.volume(..., (v) => v.namedWith(name, "ensure-exists", "disk", sizeMib))`
- [x] 4.3 Edit `src/lib/sandbox.ts`: when `docker.enabled` is true and the resolved image is not the stock image (`agent-sandbox:latest` or `docker.io/library/agent-sandbox:latest`), fail creation before any sandbox or volume is created, with an actionable error stating Docker support requires the stock image
- [x] 4.4 Add unit tests covering: volume mounted only when `docker.enabled`, custom image + `docker.enabled: true` rejected, `dataVolumeSize` converted to MiB
- [x] 4.5 Verify `bun test` passes with the new mount logic

## 5. CLI Commands

- [x] 5.1 Edit `src/commands/project-add.ts`: add "Enable Docker support? (requires the stock agent-sandbox image) (y/N)" prompt and persist `docker.enabled` (and default size) in the stored config
- [x] 5.2 Edit `src/commands/remove.ts`: when the removed project's config had `docker.enabled: true` and the `<project>-docker-data` volume exists, print a note naming the preserved volume and the `msb volume rm <project>-docker-data` cleanup command
- [x] 5.3 Verify `bun src/cli.ts project add` (scripted input) and `bun src/cli.ts remove` behave as expected

## 6. Smoke Tests

- [x] 6.1 Update `tests/smoke-test.sh` piped `project add` answers for the new Docker prompt (answer yes)
- [x] 6.2 Update `tests/smoke-test.sh`: inject Docker Hub `network.allow` rules into the smoke-test project's `projects.json` via `jq` before `create`, and add `jq` to the Step 1 host prerequisite checks (`command -v jq`) so the new host dependency fails fast
- [x] 6.3 Update `tests/smoke-test.sh`: after tool verification, assert `docker-up` succeeds, `docker info` works, and `docker run --rm hello-world` succeeds (guard the pull/run behind `SKIP_DOCKER_PULL=1` opt-out)
- [x] 6.4 Update `tests/smoke-test.sh` cleanup: remove the `smoke-test-docker-data` volume via `msb volume rm`

## 7. Documentation

- [x] 7.1 Update `README.md`: feature bullet + "Docker inside the sandbox" section (enable in project config, `docker-up`, cache persistence, volume cleanup)
- [x] 7.2 Update `docs/usage.md`: `docker` config schema, registry allow-rule table (Docker Hub hosts incl. `production.cloudfront.docker.com` blob CDN, ghcr.io, etc.), `docker-up` reference, memory guidance for large builds
- [x] 7.3 Update `docs/security.md`: nested containers stay inside the microVM boundary, no host socket mounted (unchanged), `--privileged`/`--network host` nested containers still bounded by the microVM and its egress policy
- [x] 7.4 Update `docs/architecture.md`: Docker packages in the image contents list, disk-backed volume rationale (overlay-on-overlay), manual per-boot daemon lifecycle

## 8. Final Validation

- [x] 8.1 Run `bun test` — all unit/integration tests pass
- [x] 8.2 Run `./tests/smoke-test.sh` end-to-end — all steps pass including Docker steps
- [x] 8.3 Manual check: `agent-sandbox shell` into a docker-enabled project → `docker-up` → `docker run --rm hello-world`
- [x] 8.4 Run `openspec status --change add-docker-support` and verify all artifacts are complete
