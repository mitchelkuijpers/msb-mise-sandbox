# Agent Sandbox

A microVM-based local development sandbox for coding agents (OpenCode, Codex, Pi).
Uses [microsandbox](https://github.com/microsandbox/microsandbox) for microVM
isolation with TLS-intercepting secrets injection and deny-by-default egress
control.

Real secret values never enter the microVM. They are substituted at the TLS
boundary by the microsandbox runtime. The agent sees a placeholder string
(e.g. `$MSB_GITLAB_TOKEN`); the real value is injected into outbound requests
to allowed hosts only.

## Features

- **MicroVM isolation** — the agent runs in a lightweight microVM with no
  host access, no kernel sharing, and no socket mounts.
- **Deny-by-default network policy** — all egress is blocked unless
  explicitly allowed per-host, per-protocol, per-port.
- **Secret placeholders** — real API tokens stay on the host; the sandbox
  substitutes them at the TLS boundary for allowed hosts only.
- **Project registry** — per-project configuration stored in
  `~/.agent-sandbox/projects.json` (GitLab connection, secrets, env vars,
  network rules, resource limits).
- **Custom OCI image** — Ubuntu 24.04 with mise-managed tools (Node, Python,
  OpenCode, Codex, Pi, ripgrep, fd). The image is built with Docker and loaded
  into the microsandbox runtime.
- **Docker-in-sandbox** — opt-in per-project Docker support: a disk-backed
  data volume at `/var/lib/docker` and the `docker-up` helper let the agent
  build and run containers inside the microVM, with image and build cache
  persisted across sandbox removal.
- **Project scoping** — access scope is enforced by the GitLab token's
  permissions, not by the sandbox. The sandbox merely holds the token.
- **Bun-powered CLI** — the `agent-sandbox` CLI is a TypeScript application
  run via [Bun](https://bun.sh/).

## Prerequisites

- **macOS** (or Linux with KVM support)
- **Bun** — `curl -fsSL https://bun.sh/install | bash`
- **Docker** — for building the custom OCI image
- **msb CLI** — installed by `bun install` (see below)
- ~2 GB free for the microVM image

## Quick Start

```bash
# Install dependencies
bun install

# Build the custom OCI image and load it into microsandbox
./bin/agent-sandbox build

# Register a project
./bin/agent-sandbox project add my-project
# Follow the prompts: GitLab URL, token env var, optional secrets

# Create and start the sandbox
./bin/agent-sandbox create my-project

# Launch OpenCode inside the sandbox
./bin/agent-sandbox opencode my-project

# Or launch Codex
./bin/agent-sandbox codex my-project

# Or launch Pi
./bin/agent-sandbox pi my-project

# Or open a shell
./bin/agent-sandbox shell my-project

# When done
./bin/agent-sandbox stop my-project
./bin/agent-sandbox remove my-project
```

## Installing Tools

Inside the sandbox (via `shell` or `exec`), you can install additional tools
as root:

```bash
# System packages
apt-get update && apt-get install -y graphviz

# mise tools (managed, persistent across restarts)
mise install
mise exec -- node --version

# npm global packages
npm install -g typescript

# Python packages
pip install requests

# Rust packages
cargo install ripgrep
```

Tools installed with `apt` are part of the container layer and do **not**
persist across image rebuilds. mise-managed tools (stored under
`/root/.local/share/mise`) persist across sandbox stop/start cycles but not
across sandbox removal.

## Stopping, Starting, Restarting

```bash
# Stop the sandbox
agent-sandbox stop my-project

# Restart (state preserved)
agent-sandbox start my-project
agent-sandbox restart my-project

# Check status
agent-sandbox list
```

## Removing the Sandbox

```bash
# Remove the sandbox microVM
agent-sandbox remove my-project

# Also remove the project from the registry
agent-sandbox project remove my-project
```

Removing the sandbox deletes the microVM. The project registry entry stays
until you run `project remove`. If the project had Docker enabled, the
`<project>-docker-data` volume is **preserved** (so pulled images and build
cache survive re-creation); `remove` prints its name and the
`msb volume rm <project>-docker-data` cleanup command. See
[Docker inside the Sandbox](#docker-inside-the-sandbox).

## Docker inside the Sandbox

The sandbox image ships the Docker CE engine, CLI, buildx, and compose v2.
Docker support is opt-in per project — it is **not** enabled by default,
because `dockerd` requires a disk-backed data volume (its overlay2 storage
driver cannot stack on the sandbox's overlay rootfs).

### Enabling Docker

During `project add`, answer **yes** to the "Enable Docker support?" prompt,
or add a `docker` section to the project config in
`~/.agent-sandbox/projects.json`:

```json
{
  "docker": { "enabled": true, "dataVolumeSize": "10G" }
}
```

`dataVolumeSize` is a positive integer with an uppercase `M` (MiB) or `G`
(GiB) suffix, minimum `1G` (default `10G`). Docker support requires the
stock `agent-sandbox:latest` image — creation fails fast with an actionable
error if you pair `docker.enabled: true` with a custom image.

Then (re-)create the sandbox:

```bash
agent-sandbox remove my-project   # if it already exists
agent-sandbox create my-project
```

### Starting the daemon

The microVM has no init system, so the daemon is started manually per boot
with the `docker-up` helper:

```bash
agent-sandbox exec my-project -- docker-up
# or from a shell inside the sandbox:
docker-up
```

`docker-up` is idempotent (a no-op if the daemon is already running) and
fails with an actionable error if the data volume is missing.

### Pulling images through the network policy

Docker pulls are subject to the deny-by-default egress policy. Add the
registry hosts to `network.allow` (all `:tcp:443`):

| Registry | Hosts |
|---|---|
| Docker Hub | `auth.docker.io`, `registry-1.docker.io`, `production.cloudfront.docker.com` (blob CDN; `production.cloudflare.docker.com` is the legacy variant) |
| ghcr.io | `ghcr.io`, `github.com` (auth), and the GitHub blob CDN |

### Cache persistence and cleanup

The `<project>-docker-data` volume persists across `agent-sandbox remove`,
so pulled images and build cache survive sandbox re-creation. When you
remove a docker-enabled sandbox, the CLI prints the preserved volume name
and the cleanup command:

```bash
msb volume rm my-project-docker-data
```

Running containers share the sandbox's CPU/memory limits — raise
`resources.memory` for large image builds.

## Project Registry

Per-project configuration is stored in `~/.agent-sandbox/projects.json`:

```json
{
  "projects": {
    "my-project": {
      "gitlab": {
        "url": "https://gitlab.com",
        "tokenRef": "env:GITLAB_TOKEN"
      },
      "secrets": [
        {
          "env": "OPENAI_API_KEY",
          "from": "env:OPENAI_API_KEY",
          "allow": "*.openai.com"
        }
      ],
      "network": {
        "defaultEgress": "deny",
        "allow": [
          "gitlab.com:tcp:443",
          "*.openai.com:tcp:443",
          "registry.npmjs.org:tcp:443"
        ]
      },
      "resources": {
        "cpus": 4,
        "memory": "8G"
      },
      "docker": {
        "enabled": true,
        "dataVolumeSize": "10G"
      }
    }
  }
}
```

Use `agent-sandbox project add` to create entries interactively. See
[docs/usage.md](docs/usage.md#project-configuration) for the full schema.

## Secret Placeholder Mechanism

Secrets are configured in the project registry with an `env` name, a `from`
source (e.g. `env:MY_VARIABLE`), and one or more `allow` hosts.

1. The CLI reads the real value from the host environment variable.
2. The sandbox environment variable is set to a placeholder string
   (`$MSB_<NAME>`).
3. The real value is registered on the microsandbox NetworkBuilder, which
   intercepts outbound TLS connections.
4. When the agent connects to an allowed host, the microsandbox runtime
   substitutes the placeholder with the real value in the TLS stream.
5. Connections to non-allowed hosts are blocked — the placeholder is never
   resolved there.

This means the agent never sees the real secret value. It only ever reads
the placeholder from the environment variable.

## Network Policy

The default egress policy is `deny` — all outbound traffic is blocked unless
explicitly allowed. Allow rules use the format `<host>:<protocol>:<port>`:

- `gitlab.com:tcp:443`
- `*.openai.com:tcp:443` (suffix matching)
- `registry.npmjs.org:tcp:443`

DNS resolution is automatically allowed when the default policy is `deny`.
To fully isolate a sandbox (no network access at all), set `allow: []` in
the project config.

## Project Scoping

The sandbox does not enforce project-level access restrictions. That is the
GitLab token's job — create tokens with the minimum required scope for each
project. The sandbox merely holds and forwards the token you provide.

## Documentation

- [Architecture](docs/architecture.md) — microVM model, TLS-intercepting
  secrets, network policy, project registry
- [Security](docs/security.md) — secret placeholder mechanism, violation
  policy, credential handling
- [Usage](docs/usage.md) — full CLI reference, project config schema, secret
  patterns

## Security Warnings

- **Root inside the microVM is not host root.** The agent has no more
  privileges than your user account.
- **Writable workspace mount is dangerous.** The agent can modify or delete
  files in your project directory. Use Git for version control.
- **Never expose real secret values as plain environment variables.** Use
  the secret placeholder mechanism instead.
- **Network policy is not a security boundary for malicious agents.** An
  agent that can execute arbitrary code can still exfiltrate data through
  allowed hosts. The network policy limits what external services the agent
  can reach.
