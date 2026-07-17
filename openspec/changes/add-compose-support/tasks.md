## 1. Compose client in image

- [ ] 1.1 Add Docker's official GPG key + apt source to `Containerfile` (Ubuntu 24.04)
- [ ] 1.2 Install `docker-ce-cli` and `docker-compose-plugin` only (NOT `docker-ce`) via apt
- [ ] 1.3 Add build-time verification `RUN … docker compose version` that fails the build if v2 compose is not present
- [ ] 1.4 Verify `docker info` fails during build (no socket) and succeeds only at runtime with `DOCKER_HOST` set
- [ ] 1.5 Document the exact Compose-client install method as a comment in `Containerfile`

## 2. Socket proxy (`lib/proxy.py`)

- [ ] 2.1 Write `lib/proxy.py`: raw socket server + accept loop (~30 lines)
- [ ] 2.2 Implement request parsing: read request line + headers, detect `POST` to paths ending in `/containers/create` (~30 lines)
- [ ] 2.3 Implement container-create validation: parse JSON body, validate `HostConfig.Binds` and `Mounts` against project path with `os.path.realpath()` symlink resolution (~30 lines)
- [ ] 2.4 Implement privileged/host-namespace/socket-mount rejection (~15 lines)
- [ ] 2.5 Implement bidirectional pipe via `select()` for standard HTTP, chunked streaming, and hijacked connections (~25 lines)
- [ ] 2.6 Implement 403 rejection response for failed validation (~10 lines)
- [ ] 2.7 Add CLI args (`--listen`, `--upstream`, `--project-path`) via `argparse` + signal handling (~20 lines)
- [ ] 2.8 Test the proxy standalone in the VM: forward a `GET /version` (should pass), forward a `POST /containers/create` with an out-of-project bind (should get 403), forward a valid bind (should pass)
- [ ] 2.9 Test hijacked connection: `POST /exec/{id}/start` through the proxy should pipe bidirectionally

## 3. Proxy lifecycle management in the launcher

- [ ] 3.1 Add `proxy_start()`: copy `lib/proxy.py` to VM via `podman machine ssh 'cat > /run/user/<uid>/agent-sandbox/proxy.py'`, start via `systemd-run --user --unit=agent-sandbox-proxy-<id> python3 .../proxy.py --listen .../<id>.sock --upstream .../podman.sock --project-path <canonical>` with `Restart=on-failure`
- [ ] 3.2 Add `proxy_wait()`: poll for the proxy socket file to appear (timeout ~5s)
- [ ] 3.3 Add `proxy_stop()`: `systemctl --user stop agent-sandbox-proxy-<id>`, remove proxy socket and script from VM
- [ ] 3.4 Add `proxy_restart()`: stop then start; used when a dead proxy is detected
- [ ] 3.5 Add `proxy_is_alive()`: check if the systemd unit is active and the socket exists
- [ ] 3.6 Wire proxy start into `cmd_create` (after socket discovery, before `podman create`)
- [ ] 3.7 Wire proxy stop into `cmd_remove` and `cmd_purge` (after compose cleanup, before container removal)
- [ ] 3.8 Add dead-proxy detection on `compose-*` commands: if proxy not alive, attempt `proxy_restart()` before failing

## 4. Environment diagnostics (`doctor`)

- [ ] 4.1 Add `cmd_doctor` reporting: Podman installed, Podman remote, Active connection, Machine running, Rootless engine, API socket path, Socket active, `/Users` forwarded, Compose client in image
- [ ] 4.2 Implement VM-internal socket discovery via `podman machine ssh 'printf "%s\n" "${XDG_RUNTIME_DIR}/podman/podman.sock"'` (no hard-coded UID)
- [ ] 4.3 Implement socket-existence check; if missing, attempt `systemctl --user enable --now podman.socket` once and re-check
- [ ] 4.4 Implement `/Users` forwarding check via `podman machine ssh 'test -d /Users'`
- [ ] 4.5 Verify Compose client presence in the image by running `docker compose version` in a throwaway container from the selected connection
- [ ] 4.6 Make output machine-readable where possible (stable key: value lines)

## 5. Socket discovery and `create` integration

- [ ] 5.1 Resolve the active Podman connection name; capture it for labels and for running Podman commands with `--connection <name>`
- [ ] 5.2 Discover the VM-internal socket path (reuse the doctor helper); fail `create` fast with a `agent-sandbox doctor` hint if the socket is unavailable after remediation
- [ ] 5.3 Add `--mount type=bind,source=<proxy-socket>,target=/var/run/docker.sock` and `--env DOCKER_HOST=unix:///var/run/docker.sock` to `podman create`
- [ ] 5.4 Add container label `agent-sandbox.connection=<name>`
- [ ] 5.5 Add non-dedicated-machine warning (soft warn, do not refuse) when the active connection is `podman-machine-default` or otherwise non-dedicated-looking
- [ ] 5.6 Fail `create` clearly when the proxy cannot be started (proxy socket does not appear within timeout)

## 6. Canonical project path mount

- [ ] 6.1 Resolve the project path to a canonical absolute path (handle symlinks via `pwd -P`, worktrees, spaces, `/Users` paths)
- [ ] 6.2 Mount the project at its canonical path (`--mount type=bind,source=<canonical>,target=<canonical>`) and set `--workdir <canonical>`
- [ ] 6.3 Create `/workspace` as a symlink to the canonical path inside the sandbox (convenience only; never the Compose CWD)
- [ ] 6.4 Before creating the sandbox, verify the outer engine can bind the path: `podman --connection <name> run --rm --mount type=bind,source=<canonical>,target=<canonical> alpine test -d <canonical>`; fail `create` with a clear message if not resolvable
- [ ] 6.5 Update the existing `/workspace` bind mount to the canonical-path model (this is now the default for all sandboxes)

## 7. Compose project identity and labels

- [ ] 7.1 Reuse the existing `container_name` (`agent-<basename>-<hash8>`) as `COMPOSE_PROJECT_NAME`; pass it as `--env COMPOSE_PROJECT_NAME=<name>` into the sandbox
- [ ] 7.2 Add `--env AGENT_SANDBOX_ID=<name>` and `--env AGENT_PROJECT_PATH=<canonical>` into the sandbox
- [ ] 7.3 Confirm no JSON state file is written (state lives in container labels only)

## 8. Launcher `compose-*` commands (centralized internal functions)

- [ ] 8.1 Add internal functions `compose_up`, `compose_down`, `compose_ps`, `compose_logs`, `compose_exec`, `compose_run` in `bin/agent-sandbox`; all launcher Compose commands route through them (no scattered raw `docker compose` calls)
- [ ] 8.2 Each function explicitly passes `--project-name <compose_project_name>` and sets workdir to the canonical project path
- [ ] 8.3 Construct all commands with bash arrays (no `eval`)
- [ ] 8.4 Add commands: `compose-up`, `compose-down`, `compose-ps`, `compose-logs`, `compose-config`, `compose-pull`, `compose-build`, `compose-restart`
- [ ] 8.5 Add `compose-exec` and `compose-run` with TTY allocation (`podman exec -it`); ensure `compose-up`/`compose-down`/`compose-ps`/`compose-config`/`compose-pull`/`compose-build` do NOT allocate a TTY
- [ ] 8.6 Support passthrough of extra Compose args via `--` (e.g. `compose-up . -- -f compose.yaml -f compose.agent.yaml up -d`)
- [ ] 8.7 Make `compose-*` commands fail clearly with a "no Compose configuration found" message when no Compose file is detectable
- [ ] 8.8 Wire all new commands into `usage()` and `main()` dispatch

## 9. Direct agent Compose usage inside the sandbox

- [ ] 9.1 Confirm `DOCKER_HOST`, `COMPOSE_PROJECT_NAME`, `AGENT_SANDBOX_ID`, `AGENT_PROJECT_PATH` are set in the sandbox env (via `podman exec … env` verification)
- [ ] 9.2 Add an interactive-only Compose banner to `config/bashrc` (socket path, project name, note that the socket is proxy-filtered); guarded by `$-` interactive check so it never prints in non-interactive `podman exec`
- [ ] 9.3 Add optional `agent-compose()` convenience helper in `config/bashrc` that passes `--project-name "$COMPOSE_PROJECT_NAME"`; ensure standard `docker compose` is not shadowed or altered

## 10. Lifecycle (services survive sandbox stop)

- [ ] 10.1 Confirm `agent-sandbox stop` does NOT touch Compose services by default
- [ ] 10.2 Add `AGENT_COMPOSE_STOP_WITH_SANDBOX=0` (default) and `=1` opt-in; when `1`, `stop` runs `docker compose stop` before stopping the sandbox
- [ ] 10.3 Document the default and opt-in behaviors in `docs/compose.md`

## 11. Cleanup: `remove`, `purge`, and label-based fallback

- [ ] 11.1 Implement the `remove` cleanup decision tree: running -> `docker compose down --remove-orphans` (no `--volumes`); stopped-but-valid -> start then `compose down`; otherwise -> label-based fallback; then stop proxy; then stop/rm the sandbox container
- [ ] 11.2 Implement label-based fallback: discover containers/networks/volumes by `com.docker.compose.project=<name>` via `podman ps -a --filter`, `podman network ls --filter`, `podman volume ls --filter`
- [ ] 11.3 Print the list of resources to be removed before deleting (label-based path)
- [ ] 11.4 Ensure label-based cleanup never deletes resources belonging to another Compose project
- [ ] 11.5 Handle invalid/missing Compose file: skip `compose down`, go straight to label-based cleanup
- [ ] 11.6 Preserve named Compose volumes by default in `remove`
- [ ] 11.7 Add `agent-sandbox purge` that runs `docker compose down --volumes --remove-orphans` and also removes the agent home volume
- [ ] 11.8 Add `agent-sandbox remove . --volumes` (removes only Compose volumes, preserves the home volume)
- [ ] 11.9 Wire proxy cleanup (`proxy_stop`) into `remove` and `purge` after compose cleanup, before container removal

## 12. Status and Compose file detection

- [ ] 12.1 Detect Compose files (`compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml`) in the project
- [ ] 12.2 Extend `cmd_status` to show: Compose project, Podman connection, Proxy status, Compose file, Compose services, Compose running, Compose stopped, Compose volumes, Compose networks (derive from labels + `docker compose config --services` + `podman … --filter`)
- [ ] 12.3 Do not fail sandbox creation when no Compose file is present

## 13. Documentation

- [ ] 13.1 Rewrite `docs/security.md` socket section: the sandbox now mounts a proxy-filtered socket (not raw); the proxy is the credential boundary (not the dedicated machine); document that virtiofs forwards `/Users` into every machine so the machine alone does not protect credentials
- [ ] 13.2 Create `docs/compose.md`: sibling-container architecture, proxy design, why no DinD/PinD, canonical-path model, cleanup semantics, port access, Podman vs Docker compat notes, troubleshooting; include the prominent warning that the socket is proxy-filtered
- [ ] 13.3 Update `docs/usage.md` with the new `compose-*` commands, `doctor`, `purge`, and the new env vars
- [ ] 13.4 Update `README.md` with a Compose quick-start, the prominent warning, and a disambiguation note that the repo-level `compose.yaml` runs the sandbox itself (not agent project stacks)
- [ ] 13.5 Add a doc note that after `podman machine stop/start`, Compose siblings do not auto-restart and the user must `compose-up` again; the proxy also needs restart (systemd or launcher)
- [ ] 13.6 Document the libkrun non-root write bug (#28316) as a known issue with `--provider applehv` workaround

## 14. Smoke tests

- [ ] 14.1 Create `tests/fixtures/basic-compose/compose.yaml` (web nginx with `0:80`, helper alpine `sleep infinity` with `.:/project` bind) and a fixture file
- [ ] 14.2 Create `tests/compose-smoke-test.sh` modeled on `tests/smoke-test.sh` conventions (cleanup traps, assert helpers, `set -uo pipefail`)
- [ ] 14.3 Add a connection availability check at the top of the smoke test
- [ ] 14.4 Build the image; create a temporary project at a canonical absolute path; create a sandbox (Compose is always on, no flag needed)
- [ ] 14.5 Verify inside the sandbox: `/var/run/docker.sock` exists, `DOCKER_HOST` is set, `docker info` succeeds, `docker compose version` succeeds, `docker compose config` succeeds
- [ ] 14.6 Run `docker compose up -d`; verify service containers exist in the outer engine with the expected `com.docker.compose.project` label
- [ ] 14.7 Verify the helper container's bind mount points to the intended host project directory
- [ ] 14.8 Write a file through the helper container and verify it appears in the host project directory (the linchpin proof of the canonical-path model)
- [ ] 14.9 Verify the web service is reachable through its published port
- [ ] 14.10 Verify `compose-ps` and `compose-logs`
- [ ] 14.11 Stop and restart the agent sandbox; verify Compose services remain running
- [ ] 14.12 Run `compose-down`; verify Compose containers and networks are removed and named volumes are preserved
- [ ] 14.13 Verify the proxy systemd unit is stopped and cleaned up after `remove`
- [ ] 14.14 `purge` the sandbox; verify all test resources (including volumes) are removed
- [ ] 14.15 Wire cleanup traps so resources are removed even when the test fails

## 15. Negative tests

- [ ] 15.1 Missing API socket (simulate unreachable engine; expect `create` to fail fast with the `agent-sandbox doctor` hint)
- [ ] 15.2 Inactive Podman Machine (expect `create` to fail with remediation)
- [ ] 15.3 Invalid Compose file (expect `compose-*` commands to fail clearly)
- [ ] 15.4 Project path containing spaces (expect full lifecycle to succeed)
- [ ] 15.5 Two projects with the same basename (expect distinct sandbox and Compose project names; removing one does not affect the other)
- [ ] 15.6 Compose file mounting a path outside the project (expect the proxy to reject the container-create with 403)
- [ ] 15.7 Compose file requesting `privileged: true` (expect the proxy to reject)
- [ ] 15.8 Compose file mounting the Podman socket (expect the proxy to reject)
- [ ] 15.9 Compose file with a symlink that escapes to `~/.ssh` (expect the proxy to reject via `realpath` resolution)
- [ ] 15.10 Agent container deleted before Compose cleanup (expect `remove` to fall back to label-based cleanup and succeed)
- [ ] 15.11 Proxy crash and auto-restart (kill the proxy process, verify systemd restarts it, verify `compose-ps` works after restart)
- [ ] 15.12 Compose commands run from `/workspace` instead of the canonical path (expect Compose bind mounts still resolve to the host project directory because the workdir is the canonical path, not `/workspace`)
- [ ] 15.13 Project path not accessible to the outer Podman engine (expect `create` to fail at the bind-verification step with an actionable message)
- [ ] 15.14 Verify error messages across all negative tests contain actionable remediation
