## Why

Agents today are limited to single-container work. Many real projects ship a
`compose.yaml` (web + db + cache) and expect an agent to bring the whole stack
up, tail logs, and exec into a service. There is no supported way to do this
from inside the sandbox without nested container engines, which the current
security model explicitly forbids (`docs/security.md` forbids mounting the
Podman/Docker socket). A sibling-container pattern through the outer rootless
Podman engine lets agents run project Compose stacks without DinD/PinD, but
mounting the raw socket grants the agent full engine control — including the
ability to bind-mount host credentials (`~/.ssh`, `~/.aws`) via sibling
containers, because virtiofs forwards `/Users` into every Podman Machine by
default. This change introduces a **validated socket proxy** that intercepts
container-create API calls, rejects binds outside the project path, and
forwards only allowed requests to the real Podman engine — making the proxy
(not the dedicated machine) the real credential boundary.

## What Changes

- **Every sandbox now includes Compose support.** The sandbox mounts a
  **validated proxy socket** (not the raw Podman socket) as `/var/run/docker.sock`
  and sets `DOCKER_HOST=unix:///var/run/docker.sock`. The proxy runs inside the
  Podman Machine VM as a systemd transient unit, intercepts `POST` requests to
  container-create endpoints, validates bind mounts against the project path,
  and rejects privileged/host-namespace/socket-mount requests. All other API
  calls pass through transparently. There is no opt-in flag; Compose is always
  available.
- **BREAKING (docs only + default mount model):** `docs/security.md` currently
  states the sandbox *never* mounts runtime sockets. Rewritten: the sandbox
  now mounts a **proxy-filtered** socket (not the raw socket), and the proxy is
  the credential boundary. The project mount changes from `/workspace` to the
  canonical absolute path (with `/workspace` as a symlink).
- Add a **socket proxy** (`lib/proxy.py`, ~300 lines Python stdlib only) that
  runs in the Podman Machine VM via `systemd-run --user` with
  `Restart=on-failure`. Intercepts both Docker-compatible
  (`/v1.41/containers/create`) and Podman-native
  (`/v5.0.0/libpod/containers/create`) API paths. Uses `os.path.realpath()`
  to resolve symlinks before validating binds. Handles standard HTTP,
  chunked streaming (logs), and hijacked connections (exec) via a
  `select()`-based bidirectional pipe.
- Add a **Compose v2 client** to the sandbox image (standalone `docker` CLI +
  `docker-compose` plugin, no `dockerd`/containerd/nested Podman).
- **Canonical-path mount model**: the project is mounted at its real host
  absolute path (e.g. `/Users/.../proj`) and the workdir is set to that path.
  `/workspace` becomes a convenience symlink. This is what makes Compose
  relative bind mounts resolve to the same host bytes for both the sandbox
  and the outer engine, and what the proxy validates binds against.
- Add a **`doctor` command** that detects Podman connection type, VM-internal
  socket liveness, UID (via `XDG_RUNTIME_DIR`, not hard-coded), `/Users`
  forwarding, Compose client presence, and proxy status.
- Add **launcher Compose commands**: `compose-up`, `compose-down`,
  `compose-ps`, `compose-logs`, `compose-exec`, `compose-run`, `compose-config`,
  `compose-pull`, `compose-build`, `compose-restart`.
- Reuse the existing deterministic sandbox name as the **Compose project name**
  (`agent-<basename>-<hash8>`). No new state file — connection is stored as a
  **container label** (`agent-sandbox.connection`).
- **Cleanup**: `remove` runs `docker compose down` (running sandbox) then falls
  back to label-based `podman rm` for stopped/absent sandbox or missing/invalid
  Compose file. `purge` adds `--volumes` + home volume removal. Both also stop
  and clean up the proxy systemd unit.
- Compose services **survive agent sandbox stop** by default
  (`AGENT_COMPOSE_STOP_WITH_SANDBOX=0`). Opt-in coupled lifecycle.
- Add **smoke + negative tests** including the linchpin proofs: a file written
  through a Compose helper container lands in the real host project directory,
  and a Compose file attempting to bind `~/.ssh` is rejected by the proxy.

## Capabilities

### New Capabilities
- `compose-sandbox`: The sandbox always includes Compose support via a
  **validated proxy socket** — proxy lifecycle (systemd-managed with
  auto-restart), canonical project path, deterministic Compose project name,
  container-label state, the `compose-*` launcher commands, lifecycle
  (services survive sandbox stop), and label-based cleanup (`remove`/`purge`)
  with a running→stopped→absent decision tree.

- `compose-proxy`: The socket proxy itself — a Python stdlib-only script
  (`lib/proxy.py`) that intercepts container-create API calls on both
  Docker-compatible and Podman-native paths, validates bind mounts against the
  project path (with symlink resolution), and rejects privileged, host
  namespace, and socket-mount requests. Handles standard HTTP, chunked
  streaming, and hijacked connections. Enforces always — there is no
  warn/off/enforce toggle because the proxy is in the data path, not advisory.

### Modified Capabilities
<!-- openspec/specs/ is empty — this is the first spec in the repo. The base
     sandbox's existing behavior is not yet formalized as a spec; backfilling
     it is out of scope for this change. -->

## Impact

- `bin/agent-sandbox` — extended in place (no `lib/` split for v1). Adds
  `doctor`, `compose-*` commands, `purge`, label-based cleanup, proxy
  lifecycle management, canonical-path mount (replacing `/workspace`), internal
  `compose_up()`/`compose_down()`/etc. functions kept centralized for the
  future restricted-controller handoff.
- `lib/proxy.py` — new: the socket proxy script, copied to the VM at sandbox
  creation time and started as a systemd transient unit.
- `Containerfile` — install standalone Docker CLI + `docker-compose` plugin
  (no daemon). Verify `docker compose version` at build time.
- `config/bashrc` — interactive-only Compose banner + optional
  `agent-compose` helper; no-op for non-interactive `podman exec`.
- `docs/security.md` — **rewritten** socket section: the sandbox now mounts a
  proxy-filtered socket (not raw); the proxy is the credential boundary (not
  the dedicated machine — virtiofs forwards `/Users` into every machine, so
  the machine alone does not protect credentials).
- `docs/compose.md` — new: sibling-container architecture, proxy design,
  canonical-path model, cleanup semantics, port access, Podman compat notes.
- `docs/usage.md`, `README.md` — new commands, env vars, prominent warning.
- `tests/compose-smoke-test.sh` + `tests/fixtures/{basic-compose,
  dangerous-compose,spaced-path-compose}/` — new.
- `compose.yaml` (repo-level, runs the sandbox itself) — updated to use
  canonical-path mount model; a disambiguation note distinguishes it from
  agent project stacks.
- No new runtime dependencies on the host beyond existing Podman. No
  nested container engine.
