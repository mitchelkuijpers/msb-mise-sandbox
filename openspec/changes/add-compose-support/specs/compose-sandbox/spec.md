## ADDED Requirements

### Requirement: Compose support is always available
Every sandbox SHALL include Compose support. The sandbox SHALL mount a validated proxy socket at `/var/run/docker.sock` and set `DOCKER_HOST=unix:///var/run/docker.sock` on every `create`. There SHALL be no opt-in flag or environment variable to enable or disable Compose. The project SHALL always be mounted at its canonical absolute path with `/workspace` as a convenience symlink.

#### Scenario: Create always mounts the proxy socket
- **WHEN** the user runs `agent-sandbox create .`
- **THEN** the created container SHALL mount the proxy socket at `/var/run/docker.sock`, SHALL set `DOCKER_HOST=unix:///var/run/docker.sock`, SHALL mount the project at its canonical absolute path, and SHALL set the workdir to that path

#### Scenario: /workspace is always a symlink
- **WHEN** any sandbox is running
- **THEN** `/workspace` SHALL be a symlink to the canonical project path, and the working directory of the container SHALL be the canonical path

### Requirement: Validated proxy socket is mounted, not a raw socket or nested engine
The sandbox SHALL communicate with the outer rootless Podman engine through a validated proxy socket, not the raw Podman socket. The proxy SHALL intercept container-create API calls and reject binds outside the project path, privileged mode, host namespaces, and socket mounts. The sandbox SHALL NOT run `dockerd`, `containerd`, or a nested Podman. The sandbox SHALL set `DOCKER_HOST=unix:///var/run/docker.sock`.

#### Scenario: No nested container engine runs in the sandbox
- **WHEN** a sandbox is running
- **THEN** `docker info` inside the sandbox SHALL succeed by talking to the outer engine through the proxy, and no `dockerd`/`containerd`/`podman` daemon process SHALL be running inside the sandbox

#### Scenario: Proxy socket is reachable from inside the sandbox
- **WHEN** a sandbox is running
- **THEN** the path `/var/run/docker.sock` SHALL exist inside the sandbox and `docker info` SHALL report the outer engine's information

#### Scenario: Raw Podman socket is not mounted
- **WHEN** a sandbox is created
- **THEN** the raw Podman socket SHALL NOT be mounted into the sandbox; only the proxy socket SHALL be mounted

### Requirement: VM-internal socket path is discovered, not hard-coded
The launcher SHALL discover the Podman API socket path inside the Podman Machine at runtime. It SHALL NOT hard-code a UID (e.g. 1000). The socket path SHALL be resolved from `XDG_RUNTIME_DIR` queried over `podman machine ssh`, yielding a path of the form `/run/user/<uid>/podman/podman.sock`. The launcher SHALL verify the socket file exists before using it.

#### Scenario: Socket path is discovered via XDG_RUNTIME_DIR
- **WHEN** the launcher needs the Podman socket path
- **THEN** it SHALL run `podman machine ssh 'printf "%s\n" "${XDG_RUNTIME_DIR}/podman/podman.sock"'` and use the returned path as the upstream for the proxy

#### Scenario: UID is not assumed to be 1000
- **WHEN** the Podman Machine user has a UID other than 1000 (e.g. 501)
- **THEN** the discovered socket path SHALL still be correct because the UID is read from `XDG_RUNTIME_DIR`, not assumed

#### Scenario: Missing socket is reported with remediation
- **WHEN** the discovered socket path does not exist
- **THEN** the launcher SHALL attempt `podman machine ssh 'systemctl --user enable --now podman.socket'` once, re-check, and on persistent failure SHALL fail with a message directing the user to run `agent-sandbox doctor`

### Requirement: Create fails clearly when the socket or proxy cannot be started
When the API socket cannot be located or the proxy cannot be started, `create` SHALL fail before creating any container. The failure message SHALL direct the user to `agent-sandbox doctor`.

#### Scenario: Create fails fast on missing socket
- **WHEN** the user runs `agent-sandbox create .` and the Podman API socket cannot be located after remediation
- **THEN** the command SHALL exit non-zero, SHALL NOT create a container, and SHALL print a message containing `agent-sandbox doctor`

#### Scenario: Create fails fast on proxy start failure
- **WHEN** the proxy process fails to start or its socket does not appear within a timeout
- **THEN** `create` SHALL exit non-zero, SHALL NOT create a container, and SHALL print a message containing `agent-sandbox doctor`

### Requirement: Project is mounted at its canonical absolute path
The launcher SHALL resolve the project path to a canonical absolute path and mount it at that same absolute path inside the sandbox (e.g. `/Users/alice/src/example` -> `/Users/alice/src/example`). The container working directory SHALL be set to that canonical path. `/workspace` SHALL be a convenience symlink to the canonical path and SHALL NOT be the working directory for any Compose command.

#### Scenario: Canonical path is the working directory
- **WHEN** a sandbox is created for project `/Users/alice/src/example`
- **THEN** the container SHALL be created with `--workdir /Users/alice/src/example` and `--mount type=bind,source=/Users/alice/src/example,target=/Users/alice/src/example`

#### Scenario: /workspace is a symlink, not the CWD
- **WHEN** a sandbox is running
- **THEN** `/workspace` SHALL be a symlink to the canonical project path, and the working directory of any `docker compose` invocation SHALL be the canonical path

#### Scenario: Relative bind mounts resolve to the host project directory
- **WHEN** a Compose service declares `volumes: - .:/project` and `docker compose up -d` is run inside a sandbox whose CWD is the canonical project path
- **THEN** the outer engine SHALL bind the real host project directory to `/project` in the service container, and a file written through that service container SHALL appear on the host at the canonical project path

#### Scenario: Bind mount is verified before sandbox creation
- **WHEN** the launcher is about to create a sandbox for project path P using connection C
- **THEN** the launcher SHALL run a throwaway `podman --connection C run --rm --mount type=bind,source=P,target=P alpine test -d P` and SHALL fail `create` with a clear message if the bind is not resolvable by the outer engine

### Requirement: Canonical path resolution handles real-world path shapes
`resolve_project_path` SHALL handle symbolic links (resolve to the real path via `pwd -P`), Git worktrees, paths containing spaces, paths under `/Users`, and case-sensitive path differences. The resolved path SHALL be the same path the outer Podman engine sees via virtiofs.

#### Scenario: Path containing spaces
- **WHEN** the project path is `/Users/alice/My Projects/example`
- **THEN** the sandbox SHALL be created with the mount and workdir using that exact path, and Compose bind mounts SHALL resolve correctly

#### Scenario: Symlinked project path
- **WHEN** the user passes a symlink to a project directory
- **THEN** the launcher SHALL resolve to the real path and use the real path as the canonical mount/workdir

### Requirement: Compose project name is deterministic and per-sandbox
Each sandbox SHALL have a stable, unique Compose project name equal to the existing deterministic sandbox container name (`agent-<sanitized-basename>-<hash8>`). The launcher SHALL set `COMPOSE_PROJECT_NAME` to that value in the container environment and SHALL pass `--project-name <name>` explicitly on every launcher Compose command.

#### Scenario: Project name matches sandbox name
- **WHEN** a sandbox is created for `/Users/alice/src/example`
- **THEN** `COMPOSE_PROJECT_NAME` inside the sandbox SHALL equal the container name, and both SHALL be of the form `agent-example-<hash8>`

#### Scenario: Two distinct projects get distinct project names
- **WHEN** sandboxes exist for `/Users/alice/src/example` and `/Users/alice/src/other`
- **THEN** their Compose project names SHALL differ, and a `compose-down` of one SHALL NOT affect the other's resources

### Requirement: Compose state is stored in container labels, not a state file
The launcher SHALL record sandbox state as Podman container labels on the sandbox container: at minimum `agent-sandbox.connection=<connection-name>`. The launcher SHALL NOT maintain a JSON state file. Cleanup discovery SHALL use the Compose project label `com.docker.compose.project` plus the agent-sandbox labels.

#### Scenario: Connection is discoverable from the container
- **WHEN** a sandbox exists
- **THEN** `podman inspect <name> --format '{{.Config.Labels.agent-sandbox.connection}}'` SHALL return the connection used at create time

#### Scenario: No JSON state file is created
- **WHEN** a sandbox is created and used
- **THEN** no file SHALL be written under `~/.local/state/agent-sandbox/`

### Requirement: A Compose v2 client is installed in the image without a daemon
The sandbox image SHALL contain a Docker-compatible Compose v2 client (`docker compose`) and the `docker` CLI. The image SHALL NOT contain `dockerd`, `containerd`, or a nested Podman installation. The image build SHALL verify `docker compose version` succeeds.

#### Scenario: Compose client is present at build time
- **WHEN** the image is built
- **THEN** the build SHALL run `docker compose version` and SHALL fail if it does not report a v2 compose client

#### Scenario: No daemon binaries in the image
- **WHEN** the image is inspected
- **THEN** neither `dockerd` nor `containerd` nor a nested `podman` binary SHALL be present

#### Scenario: docker info works only at runtime with the socket
- **WHEN** the image is built without the socket mounted
- **THEN** `docker info` SHALL fail during build; and SHALL succeed only in a running sandbox where `DOCKER_HOST` points at the mounted proxy socket

### Requirement: Environment diagnostics command
The launcher SHALL provide `agent-sandbox doctor` that reports, in machine-readable and human form: Podman installed (yes/no), Podman remote (yes/no), active connection name, machine running (yes/no), rootless engine (yes/no), API socket path, socket active (yes/no), `/Users` forwarded into the VM (yes/no), Compose client present in the image (yes/no), and proxy status for each sandbox.

#### Scenario: doctor reports all fields
- **WHEN** the user runs `agent-sandbox doctor`
- **THEN** the output SHALL include a line for each of: Podman installed, Podman remote, Active connection, Machine running, Rootless engine, API socket, Socket active, `/Users` forwarded, Compose client in image

#### Scenario: doctor identifies the active connection
- **WHEN** multiple Podman connections exist
- **THEN** `doctor` SHALL report the active connection name as the default connection, not necessarily `podman-machine-default`

### Requirement: Non-dedicated machine produces a warning, not a refusal
The launcher SHALL print a prominent warning when the active connection is not evidently a dedicated agent machine (e.g. `podman-machine-default`). The warning SHALL recommend a dedicated Podman Machine and SHALL state that socket access grants control over the entire associated engine. The launcher SHALL NOT refuse to proceed.

#### Scenario: Warning on default machine
- **WHEN** the user runs `agent-sandbox create .` and the active connection is `podman-machine-default`
- **THEN** the launcher SHALL print a warning mentioning dedicated Podman Machine and SHALL proceed to create the sandbox

#### Scenario: No warning for a dedicated-looking machine
- **WHEN** the active connection name indicates a dedicated agent machine (e.g. contains `agent`)
- **THEN** the launcher MAY suppress the non-dedicated warning

### Requirement: Launcher compose commands
The launcher SHALL provide: `compose-up`, `compose-down`, `compose-ps`, `compose-logs`, `compose-exec`, `compose-run`, `compose-config`, `compose-pull`, `compose-build`, `compose-restart`. Each SHALL execute the corresponding `docker compose` subcommand inside the running sandbox, explicitly passing `--project-name <compose_project_name>` and setting the workdir to the canonical project path. Commands SHALL be constructed with bash arrays, not `eval`.

#### Scenario: compose-up runs docker compose up inside the sandbox
- **WHEN** the user runs `agent-sandbox compose-up .`
- **THEN** the launcher SHALL `podman exec` the sandbox running `docker compose --project-name <name> up -d` with workdir set to the canonical project path

#### Scenario: compose-exec allocates a TTY
- **WHEN** the user runs `agent-sandbox compose-exec . app bash`
- **THEN** the launcher SHALL use `podman exec -it` (or equivalent) so the user gets an interactive terminal

#### Scenario: compose-up does not allocate a TTY
- **WHEN** the user runs `agent-sandbox compose-up .`
- **THEN** the launcher SHALL NOT allocate a TTY for the `up -d` invocation

#### Scenario: Additional Compose files are passable
- **WHEN** the user runs `agent-sandbox compose-up . -- -f compose.yaml -f compose.agent.yaml up -d`
- **THEN** the launcher SHALL forward the arguments after `--` to `docker compose` verbatim, in addition to the always-present `--project-name`

#### Scenario: Compose commands fail clearly with no Compose file
- **WHEN** the user runs any `compose-*` command against a project with no detectable Compose file
- **THEN** the command SHALL fail with a message stating no Compose configuration was found

### Requirement: Direct agent Compose usage inside the sandbox
Inside a sandbox, the agent SHALL be able to run `docker compose up/ps/logs/exec/down` directly. The environment SHALL provide `DOCKER_HOST=unix:///var/run/docker.sock`, `COMPOSE_PROJECT_NAME=<compose_project_name>`, `AGENT_SANDBOX_ID=<compose_project_name>`, and `AGENT_PROJECT_PATH=<canonical-project-path>`. An interactive shell SHALL print a one-time Compose banner with the socket path, project name, and a note that the socket is proxy-filtered. The banner SHALL NOT print during non-interactive `podman exec`.

#### Scenario: Agent runs docker compose directly
- **WHEN** the agent is in an interactive shell in a sandbox
- **THEN** `docker compose ps` SHALL work without the user passing `--project-name`, because `COMPOSE_PROJECT_NAME` is set in the environment

#### Scenario: Banner appears only for interactive shells
- **WHEN** the launcher runs `podman exec <sandbox> docker compose ps` (non-interactive)
- **THEN** the Compose banner SHALL NOT be printed; only the command output SHALL appear

#### Scenario: Standard docker compose is not shadowed
- **WHEN** a `agent-compose` convenience helper is defined
- **THEN** the standard `docker compose` command SHALL continue to work unmodified

### Requirement: Compose services survive sandbox stop by default
`agent-sandbox stop` SHALL NOT stop or remove Compose service containers. Services started by `compose-up` SHALL remain running across sandbox stop and sandbox start. The launcher SHALL provide `AGENT_COMPOSE_STOP_WITH_SANDBOX=1` to opt into coupled lifecycle, in which `stop` also runs `docker compose stop`. Default SHALL be `0`.

#### Scenario: Services remain running after sandbox stop
- **WHEN** Compose services are running and the user runs `agent-sandbox stop .` with default settings
- **THEN** the sandbox container SHALL stop and the Compose service containers SHALL remain running in the outer engine

#### Scenario: Opt-in coupled stop
- **WHEN** `AGENT_COMPOSE_STOP_WITH_SANDBOX=1` is set and the user runs `agent-sandbox stop .`
- **THEN** the launcher SHALL run `docker compose stop` before stopping the sandbox container

### Requirement: Proxy lifecycle management
The launcher SHALL start the proxy as a systemd transient unit in the Podman Machine VM during `create` and SHALL stop and remove it during `remove`/`purge`. The proxy SHALL be started with `Restart=on-failure` so it auto-recovers from crashes. The launcher SHALL detect a dead proxy on subsequent `compose-*` commands and attempt to restart it.

#### Scenario: Proxy is started during create
- **WHEN** the user runs `agent-sandbox create .`
- **THEN** the launcher SHALL copy `lib/proxy.py` to the VM, start it as a systemd transient unit with `Restart=on-failure`, wait for the proxy socket to appear, and then create the sandbox container mounting the proxy socket

#### Scenario: Proxy is stopped during remove
- **WHEN** the user runs `agent-sandbox remove .` or `agent-sandbox purge .`
- **THEN** the launcher SHALL stop the proxy systemd unit, remove the proxy socket and script from the VM, and then remove the sandbox container

#### Scenario: Proxy auto-restarts on crash
- **WHEN** the proxy process crashes while the sandbox is running
- **THEN** systemd SHALL restart it automatically and subsequent `docker compose` calls SHALL succeed without manual intervention

#### Scenario: Dead proxy is detected and restarted
- **WHEN** a `compose-*` command is run and the proxy socket is not reachable
- **THEN** the launcher SHALL attempt to restart the proxy systemd unit before failing, and SHALL fail with a clear message if the restart does not succeed

### Requirement: Cleanup decision tree for remove
`agent-sandbox remove` SHALL remove Compose resources before removing the sandbox container, following this order: (1) if the sandbox is running, run `docker compose down --remove-orphans` inside it (without `--volumes`); (2) if the sandbox is stopped but exists and the Compose file is valid, start it then run `compose down`, otherwise skip to (3); (3) fall back to label-based cleanup (see "Label-based fallback cleanup"); (4) stop the proxy systemd unit and remove proxy files from the VM; (5) then stop and remove the sandbox container. `remove` SHALL preserve named Compose volumes by default.

#### Scenario: Remove on a running sandbox runs compose down
- **WHEN** the sandbox and its Compose services are running and the user runs `agent-sandbox remove .`
- **THEN** the launcher SHALL run `docker compose down --remove-orphans` (no `--volumes`) inside the sandbox, stop the proxy, remove the sandbox container; named Compose volumes SHALL remain

#### Scenario: Remove on a stopped sandbox still cleans up
- **WHEN** the sandbox is stopped but exists and Compose services are still running in the outer engine
- **THEN** `remove` SHALL either start the sandbox and run `compose down`, or fall back to label-based cleanup, and the Compose service containers SHALL be removed

#### Scenario: Remove preserves named volumes by default
- **WHEN** the user runs `agent-sandbox remove .` and named Compose volumes exist
- **THEN** the named volumes SHALL remain after `remove` completes

### Requirement: Purge removes volumes and home
`agent-sandbox purge` SHALL behave like `remove` but SHALL pass `--volumes` to `docker compose down` and SHALL also remove the agent home named volume. The launcher SHALL support `agent-sandbox remove . --volumes` as an alias for the compose-volume portion of purge (without removing the home volume).

#### Scenario: Purge removes compose volumes and home volume
- **WHEN** the user runs `agent-sandbox purge .`
- **THEN** `docker compose down --volumes --remove-orphans` SHALL run, the proxy SHALL be stopped, the sandbox container SHALL be removed, and the agent home named volume SHALL be removed

#### Scenario: remove --volumes removes only compose volumes
- **WHEN** the user runs `agent-sandbox remove . --volumes`
- **THEN** Compose named volumes SHALL be removed and the agent home volume SHALL be preserved

### Requirement: Label-based fallback cleanup scoped to this project
When `docker compose down` is unavailable, the launcher SHALL discover and remove resources matching the label `com.docker.compose.project=<compose_project_name>` via `podman ps -a --filter`, `podman network ls --filter`, and `podman volume ls --filter`. The trigger conditions for fallback are: sandbox absent, Compose file missing, or Compose config invalid. The launcher SHALL print what will be removed before deleting. The launcher SHALL NOT delete resources belonging to any other Compose project.

#### Scenario: Cleanup after manual sandbox deletion
- **WHEN** the sandbox container was deleted manually but Compose service containers and networks remain
- **THEN** `agent-sandbox remove .` SHALL discover them by the project label, print the list, and remove them

#### Scenario: Cleanup does not touch other projects
- **WHEN** two Compose projects have resources in the same engine and the user removes one
- **THEN** only resources labeled with the removed project's `com.docker.compose.project` value SHALL be deleted; the other project's resources SHALL remain

#### Scenario: Cleanup handles invalid Compose file
- **WHEN** the Compose file is missing or `docker compose config` fails
- **THEN** `remove` SHALL skip the `compose down` attempt and SHALL proceed directly to label-based cleanup

#### Scenario: Cleanup prints before deleting
- **WHEN** label-based cleanup is about to delete resources
- **THEN** the launcher SHALL print the list of containers, networks, and volumes to be removed before performing the deletion

### Requirement: Compose file detection and status display
The launcher SHALL detect Compose files (`compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml`) in the project. `agent-sandbox status` SHALL show: Compose project name, Podman connection, proxy status, Compose file path (if detected), Compose service count, running/stopped service counts, Compose volume count, and Compose network count. The launcher SHALL NOT fail sandbox creation merely because no Compose file is present.

#### Scenario: Status shows compose fields
- **WHEN** the user runs `agent-sandbox status .` on a sandbox
- **THEN** the output SHALL include lines for `Compose project:`, `Podman connection:`, `Proxy:`, `Compose file:`, `Compose services:`, `Compose running:`, `Compose stopped:`, `Compose volumes:`, and `Compose networks:`

#### Scenario: Create succeeds without a Compose file
- **WHEN** the user runs `agent-sandbox create .` on a project with no Compose file
- **THEN** the sandbox SHALL be created successfully; `compose-*` commands invoked later SHALL fail clearly with a "no Compose configuration found" message
