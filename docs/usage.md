# Usage

## Commands

### build

```bash
agent-sandbox build
```

Builds the container image (`localhost/agent-dev:latest`) from the
`Containerfile` in the project root.

### create

```bash
agent-sandbox create [project-path]
```

Creates a sandbox container for the specified project (default: current
directory). Creates a named volume for `/root` if it doesn't exist.

The container is created but not started. Use `start` to run it.

### start

```bash
agent-sandbox start [project-path]
```

Starts the sandbox container. The entrypoint seeds `/root` from staging on
first start. Waits up to 15 seconds for the initialization marker to appear.

### stop

```bash
agent-sandbox stop [project-path]
```

Stops the sandbox container. State is preserved — use `start` to resume.

### remove

```bash
agent-sandbox remove [project-path]
agent-sandbox remove -f [project-path]
```

Removes the sandbox container. Prompts before removing the home volume (which
contains persisted tools and configuration). Use `-f` or `--force` to skip the
prompt and remove everything.

### shell

```bash
agent-sandbox shell [project-path]
```

Opens an interactive Bash shell in the running sandbox. Uses `podman exec -it`
with full terminal support.

### opencode

```bash
agent-sandbox opencode [project-path]
```

Launches OpenCode in the running sandbox. Uses `podman exec -it` with mise
activation for the correct tool environment.

### codex

```bash
agent-sandbox codex [project-path]
```

Launches Codex in the running sandbox. Uses `podman exec -it` with mise
activation.

### ssh

```bash
agent-sandbox ssh [project-path]
```

SSHes into the running sandbox. Uses a dedicated key pair managed by the CLI
(`~/.ssh/agent-sandbox-ed25519`). The SSH config alias is managed
automatically — no need to remember ports or keys.

### herdr

```bash
agent-sandbox herdr [project-path]
```

Attaches herdr to the sandbox as a thin client (`herdr --remote <container-name>`).
Requires herdr to be installed on the host (see https://herdr.dev/).
`herdr --remote` auto-installs a matching herdr binary on the container on
first connect.

This streams the remote herdr UI to your local terminal. Local desktop
features such as image clipboard paste are bridged to the remote session.

### exec

```bash
agent-sandbox exec [project-path] -- command...
```

Runs a command in the running sandbox (non-interactive, no TTY). The command
after `--` is passed directly to `podman exec`.

Examples:
```bash
agent-sandbox exec . -- mise --version
agent-sandbox exec . -- apt-get update
agent-sandbox exec . -- mise exec -- node --version
```

### status

```bash
agent-sandbox status [project-path]
```

Shows the sandbox status: container name, project path, image, status,
workspace mode, network, memory, CPUs, and root home volume name.

### logs

```bash
agent-sandbox logs [project-path]
```

Shows container logs (including entrypoint seeding output).

### rebuild

```bash
agent-sandbox rebuild [project-path]
```

Rebuilds the image and removes the old container. The home volume is
preserved. Note: new `mise.toml` tools require `mise install` inside the
container or volume removal to take effect.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AGENT_IMAGE` | `localhost/agent-dev:latest` | Container image name |
| `AGENT_CPUS` | `4` | CPU limit |
| `AGENT_MEMORY` | `8g` | Memory limit |
| `AGENT_PIDS_LIMIT` | `4096` | Maximum process count |
| `AGENT_NETWORK` | `default` | Network mode: `default` or `none` |
| `AGENT_SSH` | `1` | Enable SSH server: `1` or `0` |
| `AGENT_SSH_PORT` | `2222` | Host port mapped to container SSH port 22 |
| `AGENT_FORWARD_ENV` | `TERM,COLORTERM,LANG` | Comma-separated env vars to forward into the container |
| `AGENT_WORKSPACE_MODE` | `bind` | Workspace mode: `bind` (only `bind` implemented) |
| `AGENT_NO_NEW_PRIVILEGES` | `1` | Set to `0` to disable `no-new-privileges` |
| `AGENT_PROXY_URL` | (unset) | Reserved for future credential proxy (not implemented) |

Command-line flags override environment variables.

## Network Modes

### Default

```bash
agent-sandbox create .
```

Normal Podman network access. The agent can download packages and communicate
with external APIs.

### Restricted (no network)

```bash
AGENT_NETWORK=none agent-sandbox create .
```

The container has no network access. Tools must be pre-installed in the image
or in the persistent `/root` volume.

## Credential Handling

The sandbox never mounts host credentials. To authenticate with external
services:

### Interactive authentication (recommended)

```bash
agent-sandbox shell .
# Inside the container:
opencode auth
```

Credentials are stored in the persistent `/root` volume and survive container
restarts.

### Explicit environment variable (temporary, less secure)

```bash
AGENT_FORWARD_ENV=OPENAI_API_KEY agent-sandbox create .
agent-sandbox start .
```

This forwards the specified environment variable into the container. The
variable is visible in the container's environment. This is less secure than
interactive authentication and should only be used for temporary local
testing.

## Workspace Modes

### Bind mode (default, implemented)

```bash
agent-sandbox create .
```

The project directory is bind-mounted at `/workspace`. The agent can read and
write project files directly. Changes appear on the host immediately.

### Worktree mode (planned)

```bash
AGENT_WORKSPACE_MODE=worktree agent-sandbox create .
```

Creates a Git worktree and mounts it instead of the main project directory.
The agent works in an isolated copy. Changes must be merged back manually.

### Volume mode (planned)

```bash
AGENT_WORKSPACE_MODE=volume agent-sandbox create .
```

Creates a named volume, copies the repository into it, and runs the agent
entirely inside the volume. Use `agent-sandbox export` to copy changes back to
the host.

## Compose Alternative

For users who prefer Compose, a `compose.yaml` is provided:

```bash
PROJECT_DIR=/path/to/project podman compose up -d
podman compose exec agent bash
podman compose down
```

The CLI (`bin/agent-sandbox`) is the primary interface and uses native Podman
commands. Compose is an alternative for users who already use Compose workflows.

## Herdr Integration

[Herdr](https://herdr.dev/) is a terminal agent multiplexer. The sandbox
includes an SSH server so `herdr --remote` can attach as a thin client.
`herdr --remote` auto-installs a matching herdr binary on the container on
first connect — the container only needs sshd, not herdr pre-installed. The CLI
manages SSH access so everything works out of the box.

### Quick start

```bash
# Install herdr on the host (one-time)
curl -fsSL https://herdr.dev/install.sh | sh

# Create and start the sandbox
agent-sandbox create .
agent-sandbox start .

# Attach herdr as a thin client
agent-sandbox herdr .
```

### How it works

1. `agent-sandbox create` generates a dedicated SSH key pair and adds an
   SSH config alias for the container name.
2. `agent-sandbox start` starts the container. The entrypoint starts sshd.
3. `agent-sandbox herdr` runs `herdr --remote <container-name>`. On first
   connect, `herdr --remote` auto-installs a matching herdr binary on the
   container. It then SSHes in and streams the UI to your local terminal.

### Disabling SSH

```bash
AGENT_SSH=0 agent-sandbox create .
```

SSH is also auto-disabled when `AGENT_NETWORK=none`.

### Multiple sandboxes

Each sandbox needs a unique SSH port. Use `AGENT_SSH_PORT`:

```bash
AGENT_SSH_PORT=2223 agent-sandbox create ~/src/project-b
```
