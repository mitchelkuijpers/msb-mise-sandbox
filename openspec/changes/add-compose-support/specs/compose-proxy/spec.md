## ADDED Requirements

### Requirement: Proxy intercepts container-create API calls
The proxy SHALL intercept `POST` requests to container-create endpoints on both Docker-compatible paths (e.g. `/v1.41/containers/create`) and Podman-native paths (e.g. `/v5.0.0/libpod/containers/create`). The proxy SHALL parse the JSON request body and validate it before forwarding. All other API requests SHALL pass through transparently without inspection.

#### Scenario: Docker-compatible create path is intercepted
- **WHEN** the Compose client sends `POST /v1.41/containers/create` with a JSON body
- **THEN** the proxy SHALL parse the body, validate it, and forward it to the upstream Podman socket only if validation passes

#### Scenario: Podman-native create path is intercepted
- **WHEN** a direct API call sends `POST /v5.0.0/libpod/containers/create` with a JSON body
- **THEN** the proxy SHALL parse the body, validate it, and forward it to the upstream Podman socket only if validation passes

#### Scenario: Non-create requests pass through untouched
- **WHEN** any request that is not a container-create `POST` arrives (e.g. `GET /containers/json`, `POST /containers/{id}/start`, `GET /version`)
- **THEN** the proxy SHALL forward it transparently without parsing or modifying the body

### Requirement: Proxy validates bind mounts against the project path
The proxy SHALL reject any container-create request whose bind mounts reference a path outside the canonical project path. The proxy SHALL resolve symlinks using `os.path.realpath()` in the VM filesystem before comparing, so a project symlink pointing to `~/.ssh` is caught. The proxy SHALL validate both `HostConfig.Binds` (string format `source:target:opts`) and `Mounts` entries with `Type == "bind"`.

#### Scenario: Bind within project is allowed
- **WHEN** a container-create request has a bind mount with source `/Users/alice/src/example/data` and the project path is `/Users/alice/src/example`
- **THEN** the proxy SHALL forward the request to the upstream Podman socket

#### Scenario: Bind outside project is rejected
- **WHEN** a container-create request has a bind mount with source `/Users/alice/.ssh` and the project path is `/Users/alice/src/example`
- **THEN** the proxy SHALL reject the request with a 403 response and SHALL NOT forward it

#### Scenario: Symlink escape is caught
- **WHEN** a container-create request has a bind mount with source `/Users/alice/src/example/data` where `data` is a symlink to `/Users/alice/.ssh`
- **THEN** the proxy SHALL resolve the symlink via `os.path.realpath()`, detect that the real path is outside the project, and reject the request

#### Scenario: Structured Mounts are validated
- **WHEN** a container-create request has a `Mounts` entry with `Type: "bind"` and `Source: /Users/alice/.aws`
- **THEN** the proxy SHALL reject the request

### Requirement: Proxy rejects privileged and host-namespace requests
The proxy SHALL reject container-create requests where `HostConfig.Privileged` is true, or where `HostConfig.NetworkMode`, `HostConfig.PidMode`, `HostConfig.IpcMode`, or `HostConfig.CgroupMode` is set to `host`.

#### Scenario: Privileged is rejected
- **WHEN** a container-create request has `HostConfig.Privileged: true`
- **THEN** the proxy SHALL reject the request with a 403 response

#### Scenario: Host network is rejected
- **WHEN** a container-create request has `HostConfig.NetworkMode: "host"`
- **THEN** the proxy SHALL reject the request

#### Scenario: Host PID is rejected
- **WHEN** a container-create request has `HostConfig.PidMode: "host"`
- **THEN** the proxy SHALL reject the request

### Requirement: Proxy rejects socket-mount requests
The proxy SHALL reject container-create requests that mount `/var/run/docker.sock`, any `podman.sock` path, or any path ending in `docker.sock` or `podman.sock` as a bind source.

#### Scenario: Docker socket mount is rejected
- **WHEN** a container-create request has a bind mount with source `/var/run/docker.sock`
- **THEN** the proxy SHALL reject the request

#### Scenario: Podman socket mount is rejected
- **WHEN** a container-create request has a bind mount with source `/run/user/501/podman/podman.sock`
- **THEN** the proxy SHALL reject the request

### Requirement: Proxy handles all connection modes
The proxy SHALL handle three Docker/Podman API connection modes: standard HTTP (request/response, e.g. `containers/create`), chunked streaming (e.g. `logs?follow=true`, `events`), and hijacked connections (e.g. `exec/{id}/start`, `attach`). The proxy SHALL use a `select()`-based bidirectional pipe that works for all three modes without buffering.

#### Scenario: Standard HTTP requests are forwarded and responses returned
- **WHEN** the Compose client sends a standard request-response API call
- **THEN** the proxy SHALL forward it and return the upstream response without modification

#### Scenario: Streaming responses are forwarded without buffering
- **WHEN** the Compose client requests `logs?follow=true`
- **THEN** the proxy SHALL pipe chunks from the upstream to the client as they arrive, without buffering the entire response

#### Scenario: Hijacked connections are forwarded bidirectionally
- **WHEN** the Compose client starts an exec with a TTY (hijacked connection)
- **THEN** the proxy SHALL pipe bytes bidirectionally (client stdin to engine, engine stdout to client) using `select()` until the connection closes

### Requirement: Proxy is always-on enforcement with no toggle
The proxy SHALL enforce validation on every container-create request. There SHALL be no `off`, `warn`, or `enforce` mode toggle — the proxy is in the data path, not advisory. The agent cannot bypass the proxy because the raw Podman socket is not mounted into the sandbox.

#### Scenario: No bypass is possible
- **WHEN** the agent attempts to reach the raw Podman socket directly
- **THEN** the attempt SHALL fail because only the proxy socket is mounted at `/var/run/docker.sock`; the raw socket path is not accessible from inside the sandbox

#### Scenario: Every create is validated
- **WHEN** any container-create request reaches the proxy
- **THEN** it SHALL be validated regardless of how it was constructed (Compose client, direct curl, raw HTTP)

### Requirement: Proxy runs as a systemd transient unit with auto-restart
The proxy SHALL be started via `systemd-run --user --unit=agent-sandbox-proxy-<id>` with `Restart=on-failure` in the Podman Machine VM. The proxy script (`lib/proxy.py`) SHALL be copied to the VM at sandbox creation time. The proxy socket path SHALL be `/run/user/<uid>/agent-sandbox/<sandbox-id>.sock`.

#### Scenario: Proxy starts as a systemd unit
- **WHEN** the launcher creates a sandbox
- **THEN** it SHALL copy `lib/proxy.py` to the VM and start it via `systemd-run --user --unit=agent-sandbox-proxy-<id>` with `Restart=on-failure`

#### Scenario: Proxy auto-restarts on crash
- **WHEN** the proxy process exits with a failure
- **THEN** systemd SHALL restart it automatically

#### Scenario: Proxy socket path is per-sandbox
- **WHEN** multiple sandboxes exist
- **THEN** each SHALL have its own proxy socket at `/run/user/<uid>/agent-sandbox/<sandbox-id>.sock`

### Requirement: Proxy is Python stdlib-only with no dependencies
The proxy SHALL be a single Python file using only the Python standard library (`socket`, `select`, `json`, `os`, `sys`, `signal`, `argparse`). The proxy SHALL NOT require any pip-installed packages. The proxy SHALL be compatible with Python 3.14+ (the version shipped in the Podman Machine VM).

#### Scenario: No external dependencies
- **WHEN** the proxy script is copied to the VM
- **THEN** it SHALL run with `python3 lib/proxy.py` without any `pip install` or package setup

#### Scenario: Single file
- **WHEN** the proxy is deployed
- **THEN** it SHALL consist of exactly one `.py` file with no companion modules
