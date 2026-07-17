## Context

The existing sandbox (`bin/agent-sandbox`, 724 lines, stateless) runs a single
container per project on rootless Podman under a libkrun Podman Machine on
macOS. `docs/security.md:42-49` currently forbids mounting any runtime socket.
Agents therefore cannot run project `compose.yaml` stacks without nested
container engines (DinD/PinD), which the project deliberately avoids.

This change makes Compose support part of every sandbox using the
**sibling-container pattern via a validated socket proxy**: the sandbox
mounts a proxy socket (not the raw Podman socket), and the proxy intercepts
container-create API calls, rejecting binds outside the project path.

Environment verified on the target machine before this design (Podman 5.8.3,
libkrun VM, user `core` uid=501 gid=1000):

- The active connection is `ssh://core@127.0.0.1:49163/...`. There is **no
  host-side socket file**; the only live socket is VM-internal at
  `/run/user/501/podman/podman.sock` (`srw-rw---- core core`).
- `podman.socket` is already `active` + `enabled` in the VM.
- `/Users`, `/private`, and `/var/folders` are mounted into the VM via
  **virtiofs (rw)**. A bind source of `/Users/.../proj` therefore resolves to
  the same host bytes whether the request originates from the host CLI or
  from inside a sandbox over the mounted socket.
- **Empirically verified**: a throwaway container on the default machine can
  `bind /Users/mitkuijp/.ssh` and read all private keys — the raw socket
  grants full host-credential access via sibling bind mounts.
- **Empirically verified**: `podman machine init --volume` **replaces** the
  default forwards (confirmed from Podman source `cmd/podman/machine/init.go`).
  A machine forwarding only `~/Development` makes `~/.ssh` unreachable
  (`statfs: no such file or directory`). However, narrow-forward machines are
  a user-setup concern, not a sandbox-feature.
- **Empirically verified**: a Python stdlib-only proxy forwards API calls
  (standard HTTP, streaming, hijacked) correctly to the Podman socket, and
  `systemd-run --user` manages its lifecycle.

## Goals / Non-Goals

**Goals:**
- Agents can run `docker compose up/ps/logs/exec/down` (and launcher
  equivalents) against project Compose stacks, with no nested engine.
- Compose bind mounts resolve to the real host project directory.
- Each sandbox gets a stable, unique Compose project name with no new state
  subsystem.
- **The proxy is the credential boundary**: binds outside the project path
  are rejected at the API level, not advisory. The agent cannot bypass the
  proxy because the raw socket is not mounted.
- Cleanup is reliable across running / stopped / absent / invalid-Compose-file
  states.
- The internal Compose command surface is centralized so a future restricted
  controller can extend the proxy.

**Non-Goals:**
- Docker-in-Docker or Podman-in-Podman.
- Opt-in Compose mode — Compose is always available in every sandbox.
- Machine management commands (`machine-create/start/stop/reset`) in
  milestone 1 — `doctor` detects and warns only.
- Network/volume creation interception — the proxy only intercepts
  `containers/create` in v1.
- A `lib/` directory split for the CLI — monolith retained through v1.
- A JSON state file — container labels only.

## Decisions

### D1: Sibling containers via validated proxy socket (not raw socket, not DinD/PinD)
**Choice:** Mount a proxy socket into the sandbox as `/var/run/docker.sock`.
The proxy runs in the VM, intercepts container-create API calls, validates
binds against the project path, and forwards allowed requests to the real
Podman socket. The raw Podman socket is never mounted into the sandbox.
**Why over alternatives:**
- Raw socket (original plan): rejected — grants full engine control including
  `~/.ssh` exfiltration via sibling bind mounts (empirically verified).
- DinD/PinD: rejected — project non-goal; doubles resource cost; requires
  re-adding `SYS_ADMIN` cap the sandbox exists to drop.
- Narrow-forward machine alone: helps but doesn't enforce — the agent could
  still bind any forwarded path; it's a user-setup option, not a sandbox
  mechanism.
**Verified:** Python proxy forwards API calls correctly; `systemd-run`
manages lifecycle.

### D2: Mount the VM-internal socket path, not a host path
**Choice:** The proxy's upstream is the VM-internal socket at
`/run/user/<uid>/podman/podman.sock`, discovered via `XDG_RUNTIME_DIR` over
SSH — never a hard-coded UID and never a host path.
**Why:** on libkrun there is no host socket file; the host talks to the engine
over SSH. The only bind-able socket is the one inside the VM. Hard-coding UID
1000 is wrong on this machine (uid=501).
**Alternatives:** host-forwarded socket (does not exist here); TCP API
endpoint (extra exposure surface). Rejected.

### D3: Canonical project path mount (the load-bearing decision)
**Choice:** The project is mounted at its real host absolute path (e.g.
`/Users/mitkuijp/.../proj`), `--workdir` is set to that path, and `/workspace`
is a convenience symlink that is never the Compose CWD. This is now the
default for all sandboxes, not a Compose-mode-only behavior.
**Why:** Compose resolves `./data` relative to the sandbox CWD and hands that
absolute path to the outer engine as a bind source. With `/workspace` as CWD,
the engine would be asked to bind `/workspace/data` — a path that exists only
in the sandbox's mount namespace, not in the VM. With the canonical path as
CWD, the engine is asked to bind `/Users/.../proj/data`, which virtiofs
resolves to the same host bytes the sandbox sees. The proxy also validates
binds against this canonical path.
**Verified:** `/Users` is virtiofs (rw) in the VM, so this resolution works
through the socket. The smoke test proves it by writing a file through a
Compose helper container and reading it on the host.

### D4: Container labels for state, no JSON state file
**Choice:** Store `podman_connection` as a container label
(`agent-sandbox.connection=<name>`). Reuse the existing deterministic sandbox
name (`agent-<basename>-<hash8>`) as the Compose project name — no new storage
needed for it.
**Why:** the CLI is proudly stateless today. Labels are the Podman-idiomatic
mechanism, travel with the container, need no drift handling, and survive CLI
reinstalls. Compose itself tracks projects via `com.docker.compose.project`
labels — we lean on that for cleanup discovery.

### D5: Monolith retained; centralized internal functions
**Choice:** Keep all CLI code in `bin/agent-sandbox`. Add internal functions
`compose_up()`, `compose_down()`, etc. and route all launcher Compose commands
through them. The proxy lives in `lib/proxy.py` (a data file the launcher
copies to the VM, not a CLI source split).
**Why:** the 724-line script is clean and working; splitting before the shape
is known is risky. A `lib/` split can follow later as its own change.

### D6: Proxy is always-on enforcement, no toggle
**Choice:** The proxy validates every container-create request. There is no
`off`/`warn`/`enforce` toggle. The proxy is in the data path, not advisory —
the agent cannot bypass it because the raw socket is not mounted.
**Why:** any client-side check is advisory given raw socket access. The proxy
makes enforcement real by being the only path to the engine. This replaces
the original plan's `compose-policy` / `compose-check` advisory layer entirely.

### D7: Soft warn on non-dedicated machine (no hard gate)
**Choice:** `doctor` and `create` print a clear warning if the active
connection is `podman-machine-default` (or otherwise not evidently a dedicated
agent machine), but they do not refuse to proceed.
**Why:** a hard gate is safer but hostile to the user who has intentionally
chosen a single-machine workflow. The proxy is the primary defense; machine
hygiene is defense-in-depth.

### D8: Proxy is the credential boundary (not the dedicated machine)
**Choice:** The proxy blocks binds outside the project path, including
`~/.ssh`, `~/.aws`, `~/.config`, `~/.gnupg`, and any other host path. The
dedicated-machine recommendation remains (defense-in-depth for resource
isolation) but is no longer the primary credential boundary.
**Why:** empirically verified that virtiofs forwards `/Users` into every
machine — dedicated or not — so the machine alone does not protect
credentials. The proxy does, because it runs in the VM where it can
`os.path.realpath()` bind sources before forwarding.
**Key detail:** the proxy resolves symlinks in the VM's filesystem, so a
project symlink `data -> ~/.ssh` is caught: `realpath("/Users/.../proj/data")`
returns `/Users/.../.ssh` which is outside the project → rejected.

### D9: Proxy runs as systemd transient unit with auto-restart
**Choice:** Start the proxy via `systemd-run --user --unit=agent-sandbox-proxy-<id>`
with `Restart=on-failure`. The proxy script (`lib/proxy.py`) is copied to the
VM at create time. Proxy socket path: `/run/user/<uid>/agent-sandbox/<id>.sock`.
**Why:** systemd handles crashes (auto-restart), logging (journald), and clean
shutdown. The launcher detects a dead proxy on `compose-*` commands and
restarts the unit.
**Verified:** `systemd-run --user` works in the VM; `systemctl --user
is-active` confirms; `systemctl --user stop` cleans up.

### D10: Proxy intercepts both Docker-compatible and Podman-native paths
**Choice:** The proxy matches `POST` requests to paths ending in
`/containers/create` — both `/v1.41/containers/create` (Docker-compatible,
used by `docker compose`) and `/v5.0.0/libpod/containers/create` (Podman-native,
used by direct `curl`).
**Why:** the Compose client uses Docker-compatible paths, but an agent could
craft raw HTTP to the Podman-native path to bypass validation. Intercepts both.

### D11: Proxy is Python stdlib-only, single file
**Choice:** `lib/proxy.py`, ~300 lines, using only `socket`, `select`, `json`,
`os`, `sys`, `signal`, `argparse`. No pip packages, no companion modules.
**Why:** Python 3.14 is already in the VM with all stdlib modules needed. No
compilation, no runtime to install, no dependencies to manage. Go would
require cross-compiling on the host and shipping a binary.

### D12: Compose client = apt `docker-ce-cli` + `docker-compose-plugin` (no daemon)
**Choice:** Add Docker's official apt source + GPG key to the image, then
install `docker-ce-cli` and `docker-compose-plugin` only. NOT `docker-ce`
(which includes `dockerd`). `docker info` succeeds only because `DOCKER_HOST`
points at the mounted proxy socket.
**Why:** the mise/aqua registry does not carry `docker` or `docker-compose`
(verified). apt is the standard, version-pinnable path. Installing only the
CLI packages avoids pulling in `dockerd` or `containerd`.
**Alternatives:** direct-curl standalone binaries (viable but less standard);
mise/aqua (unavailable); `podman compose` inside the sandbox (contradicts
no-nested-Podman non-goal).

### D13: Cleanup decision tree (running -> stopped -> absent -> invalid)
**Choice:** `remove` follows this order:
1. Sandbox running -> `docker compose down --remove-orphans` inside it.
2. Sandbox stopped but exists, Compose file valid -> start then `compose down`;
   if Compose file missing/invalid -> skip to step 3.
3. Label-based cleanup by `com.docker.compose.project=<name>`.
4. Stop proxy systemd unit, remove proxy files from VM.
5. Stop and remove the sandbox container.
`purge` adds `--volumes` to `compose down` and removes the home volume.

### D14: Lifecycle — services survive sandbox stop by default
**Choice:** `agent-sandbox stop` does NOT touch Compose services
(`AGENT_COMPOSE_STOP_WITH_SANDBOX=0`). Opt-in coupled lifecycle stops services
with the sandbox. `remove`/`purge` always attempt Compose cleanup + proxy
cleanup.

## Risks / Trade-offs

- **[Proxy is a new single point of failure]** -> `Restart=on-failure` via
  systemd + launcher detects dead proxy and restarts on `compose-*` commands.
- **[Proxy bug could block legitimate Compose]** -> smoke test covers standard
  Compose workflows; proxy validates only `containers/create`, everything else
  passes through transparently.
- **[VM socket path varies by UID / machine]** -> discover at runtime via
  `XDG_RUNTIME_DIR` over `podman machine ssh`. `doctor` surfaces clear
  failure if socket is absent.
- **[`/Users` not forwarded on some setups]** -> `doctor` checks virtiofs
  forwarding; `create` verifies the bind with a throwaway container.
- **[Symlink traversal in bind mounts]** -> proxy uses `os.path.realpath()`
  in the VM filesystem before validating.
- **[Machine restart kills siblings]** -> document: after `podman machine
  stop/start`, run `compose-up` again. Proxy also needs restart (systemd
  auto-starts on machine boot if unit is enabled; otherwise launcher
  restarts on next `compose-*` command).
- **[Existing /workspace mount model changes]** -> breaking change for
  existing users; `/workspace` remains as a symlink so muscle memory works.
- **[Fixed host port conflicts across sandboxes]** -> document; recommend
  dynamic host ports. No auto-rewrite in v1.
- **[libkrun non-root write bug (#28316)]** -> document as known issue;
  recommend `--provider applehv` if Compose services run as non-root and
  encounter write permission errors.

## Migration Plan

- No data migration. The existing `/workspace` mount is replaced by the
  canonical-path mount (with `/workspace` as a symlink).
- Build the image with the Compose client (additive layer).
- Rollback: `git revert` + image rebuild. No on-disk state to unwind (state
  lives in container labels that vanish with the container). Proxy units in
  the VM are cleaned up by `remove`/`purge`; orphaned units can be cleaned with
  `systemctl --user stop 'agent-sandbox-proxy-*'`.

## Resolved Questions

- **Compose client install method**: The mise/aqua registry does NOT carry
  `docker` or `docker-compose` (verified: `mise registry list` returns nothing
  for either). Decision: install via apt — add Docker's official apt source +
  GPG key, then install `docker-ce-cli` and `docker-compose-plugin` only (NOT
  `docker-ce`, which includes `dockerd`). This gives the standard `docker
  compose` subcommand without any daemon. (D12 resolved.)
- **`compose-logs --follow` signal handling**: `podman exec -it` forwards
  signals to the process inside the container. `docker compose logs --follow`
  catches SIGINT to stop tailing without stopping services (standard Docker
  Compose behavior). No explicit signal handling is needed in the launcher;
  `podman exec -it` handles it. (Resolved.)
