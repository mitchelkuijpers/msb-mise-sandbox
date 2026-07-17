# Podman Agent Sandbox

A reusable local development sandbox based on rootless Podman on macOS.
The sandbox runs a coding agent as root inside the container while keeping
the host isolated through rootless Podman.

## Features

- **Root inside the container** — the agent can install tools with apt, mise,
  npm, pipx, cargo, and similar package managers.
- **Project mount** — your project directory is mounted at `/workspace`.
- **Interactive TUIs** — OpenCode and Codex work through `podman exec -it`.
- **Persistent tools** — agent tools, caches, configuration, and shell history
  persist in a named volume at `/root`.
- **Host isolation** — no `--privileged`, no Podman socket, no host credential
  mounts, no host PID/network/IPC namespaces.
- **SSH + herdr** — optional SSH server for `herdr --remote` thin-client
  attach. Dedicated key pair, managed automatically.
- **Small CLI wrapper** — `bin/agent-sandbox` manages the full lifecycle.

## Prerequisites

- **macOS** with [Podman](https://podman.io/) installed
- Podman machine running: `podman machine start`
- ~2 GB free for the container image

## Quick Start

```bash
# Build the image
./bin/agent-sandbox build

# Create a sandbox for your project
cd ~/src/my-project
/path/to/agent-sandbox create

# Start the sandbox
/path/to/agent-sandbox start

# Launch OpenCode
/path/to/agent-sandbox opencode

# Or launch Codex
/path/to/agent-sandbox codex

# Or open a shell
/path/to/agent-sandbox shell

# Or attach via herdr (requires herdr on the host)
/path/to/agent-sandbox herdr
```

## Installing Tools

Inside the container (via `shell` or `exec`), you can install tools as root:

```bash
# System packages
apt-get update && apt-get install -y graphviz

# mise tools (managed, persistent)
mise install
mise exec -- node --version

# npm global packages
npm install -g typescript

# Python packages
pip install requests

# pipx packages
pipx install black

# Rust packages
cargo install ripgrep
```

Tools installed with apt are stored in the container layer and persist across
stop/start cycles. They do **not** persist across container recreation
(`remove` + `create`). mise tools are stored in the `/root` named volume and
persist across recreation.

## Stopping and Restarting

```bash
# Stop the sandbox
agent-sandbox stop .

# Restart (tools and state preserved)
agent-sandbox start .

# Check status
agent-sandbox status .
```

## Remote Access with Herdr

The sandbox includes an SSH server for `herdr --remote` attach.
`herdr --remote` auto-installs a matching herdr binary on the container on
first connect — the container only needs sshd, not herdr pre-installed.

```bash
# Install herdr on the host (one-time)
curl -fsSL https://herdr.dev/install.sh | sh

# Create and start the sandbox
/path/to/agent-sandbox create
/path/to/agent-sandbox start

# Attach as a thin client
/path/to/agent-sandbox herdr
```

SSH is enabled by default. Disable with `AGENT_SSH=0`. See
[Usage](docs/usage.md#herdr-integration) for details.

## Removing the Sandbox

```bash
# Remove the container (prompts about volume)
agent-sandbox remove .

# Remove container + volume (no prompt)
agent-sandbox remove -f .
```

Removing the home volume deletes all persisted mise tools, caches, and
configuration. The container will re-seed from the image on next create.

## Persistence Behavior

| What | Where | Survives stop/start | Survives remove/create |
|---|---|---|---|
| Project files | /workspace (bind mount) | Yes (host dir) | Yes (host dir) |
| mise tools | /root (named volume) | Yes | Yes |
| apt packages | container layer | Yes | **No** |
| Shell history | /root (named volume) | Yes | Yes |
| Agent config | /root (named volume) | Yes | Yes |

If you update `mise.toml` and rebuild the image, existing containers keep
their old tools (the entrypoint never re-seeds after the first start). To get
new tools, run `mise install` inside the container or remove the home volume
and recreate.

## Security Warnings

- **Root inside the container is not host root.** Rootless Podman maps
  container UID 0 to your host user. The agent has no more privileges than you.
- **Writable bind mounts are dangerous.** The agent can modify or delete files
  in your project directory. Use Git worktrees or disposable volumes for risky
  tasks.
- **Never mount the Podman or Docker socket.** This would give the agent full
  control over all containers on the host.
- **Never mount host credentials** (`~/.ssh`, `~/.aws`, `~/.config`). Authenticate
  interactively inside the container instead.
- **Network access is an independent risk.** Use `AGENT_NETWORK=none` for
  isolated builds.

See [docs/security.md](docs/security.md) for the full security model.

## Troubleshooting (macOS)

**Podman machine not running**
```bash
podman machine start
```

**Build fails with DNS errors**
The Podman machine network can be flaky. Retry the build. If it persists,
restart the machine: `podman machine stop && podman machine start`.

**Container starts but tools don't work**
The entrypoint may not have finished seeding. Check logs:
```bash
agent-sandbox logs .
```
Look for "Seeding complete." If missing, the staging copy may have failed.

**Out of memory**
The Podman machine defaults to 2 GB. Increase it for heavy workloads:
```bash
podman machine stop
podman machine set --memory 4096
podman machine start
```

**Permission denied on /root files after restart**
This was a known issue with `cp -a` preserving image-layer xattrs. The
entrypoint uses `cp -rp` to avoid this. If it recurs, report it.

## Documentation

- [Architecture](docs/architecture.md) — rootless Podman, container lifecycle,
  mount behavior
- [Security](docs/security.md) — threat model, capability restrictions,
  credential handling
- [Usage](docs/usage.md) — full CLI reference and environment variables
