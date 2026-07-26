# Architecture

## Overview

The agent sandbox provides a microVM environment for coding agents
(OpenCode, Codex, Pi) with three key properties:

1. **Isolation** — the agent runs in a lightweight microVM, not a container.
   No kernel sharing, no host socket mounts, no privileged access.
2. **Secrets at the boundary** — real API tokens never enter the microVM.
   The microsandbox runtime intercepts outbound TLS and substitutes
   placeholders with real values for allowed hosts only.
3. **Deny-by-default network** — all egress is blocked unless explicitly
   allowed. Allow rules are per-host, per-protocol, per-port.

The project uses the [microsandbox](https://github.com/microsandbox/microsandbox)
TS SDK (v0.6.6) for microVM lifecycle management and the `msb` CLI for
day-to-day operations.

## Architecture Diagram

```
macOS / Linux host
  └── Bun runtime
      └── agent-sandbox CLI (TypeScript, commander)
          ├── msb CLI (microsandbox lifecycle)
          └── microsandbox TS SDK (Sandbox.builder, NetworkBuilder)
              └── Microsandbox Runtime
                  └── MicroVM
                       ├── OCI image (Ubuntu 24.04 + mise tools + Docker CE)
                       ├── /workspace (bind mount of project directory)
                       ├── /var/lib/docker (disk-backed named volume when docker.enabled)
                       ├── Secret placeholders (env: $MSB_<NAME>)
                       └── TLS-intercepting proxy (substitutes secrets)
```

## Build Pipeline

The custom OCI image is built in two steps:

```
docker build --load -t agent-sandbox:latest -f Containerfile .
docker save agent-sandbox:latest | msb image load --tag agent-sandbox:latest
```

The image is based on `ubuntu:24.04` and includes:

- System packages (git, curl, build-essential, openssh-client, etc.)
- [mise](https://mise.jdx.dev/) installed at `/usr/local/bin/mise`
- Mise-managed tools: Node 24, Python 3.12, Bun, OpenCode, Codex, Pi,
  ripgrep, fd, openspec
- A `mise.toml` config copied into `/root/.config/mise/config.toml`
- Docker CE (`docker-ce`, `docker-ce-cli`, `containerd.io`, buildx and
  compose plugins) from Docker's official apt repository, plus the
  `/usr/local/bin/docker-up` per-boot startup helper

The image has **no entrypoint**. The microsandbox runtime boots the image
directly. There is no seeding step, no init marker, and no SSH server
(started by the user if needed).

## Project Registry

Per-project configuration is stored at `~/.agent-sandbox/projects.json`:

```typescript
interface ProjectConfig {
  image?: string;               // OCI image reference (default: agent-sandbox:latest)
  gitlab: GitLabConfig;         // GitLab URL + token reference
  secrets?: SecretEntry[];      // Host-injected secrets
  env?: Record<string, string>; // Non-sensitive env vars
  network?: NetworkConfig;      // Egress policy + allow rules
  resources?: ResourceLimits;   // CPU, memory limits
  mounts?: MountConfig;         // Guest mount paths; `/root` is not blanket-mounted by default
  docker?: DockerConfig;        // Opt-in Docker-in-sandbox (disk-backed /var/lib/docker volume)
  onSecretViolation?:           // Action on secret misuse
    "block" | "block-and-log" | "block-and-terminate";
}
```

See [Usage](docs/usage.md#project-configuration) for the full schema.

## Secret Placeholder Mechanism

Secrets are injected at the TLS boundary, not as plain environment variables:

1. **Registry**: each secret has an `env` (name inside the sandbox), a `from`
   source (e.g. `env:HOST_VARIABLE`), and an `allow` host list.
2. **Resolution**: the CLI reads the real value from the host environment
   variable at sandbox-creation time.
3. **Placeholder**: the sandbox environment variable is set to a placeholder
   string: `$MSB_<env>`. The agent reads this string when it inspects the
   environment.
4. **Registration**: the real value is registered on the microsandbox
   `NetworkBuilder` via `.secret(...)`. TLS interception is enabled.
5. **Substitution**: when the agent makes an outbound TLS connection to an
   allowed host, the microsandbox runtime replaces the placeholder with the
   real value in the TLS stream. Connections to non-allowed hosts are
   blocked.

```
Agent process              Microsandbox runtime           External API
   │                              │                            │
   │ reads env:                    │                            │
   │ GITLAB_TOKEN=$MSB_GITLAB_TOKEN                            │
   │                              │                            │
   │ ───── TLS connect ────────►  │                            │
   │       gitlab.com:443         │                            │
   │                              │ ──── TLS connect ───────►  │
   │                              │     (with real token)      │
   │                              │◄──── response ───────────  │
   │◄──── response ─────────────  │                            │
```

## Network Policy

The default egress policy is `deny`. All outbound traffic is blocked unless
explicitly allowed. Allow rules follow the format:

```
<host>:<protocol>:<port>
```

- **host**: exact domain name or `*.`-prefixed suffix (e.g. `*.openai.com`)
- **protocol**: `tcp` or `udp`
- **port**: 1–65535

DNS resolution is automatically allowed when the default policy is `deny`,
so domain-based allow rules can resolve.

To fully isolate a sandbox (no network access at all), set `network.allow`
to an empty array.

## Docker-in-sandbox

Docker support is an opt-in, per-project capability (`docker.enabled`).

### Disk-backed data volume

`dockerd`'s default overlay2 storage driver cannot stack on the sandbox's
overlay-backed rootfs, so a disk-backed named volume at `/var/lib/docker`
is **required**, not just for persistence. When `docker.enabled` is true,
`createSandbox` mounts `<project>-docker-data` via the SDK's
`namedWith(name, "ensure-exists", "disk", sizeMib)` — created-or-reused
idempotently as an ext4 volume (`/dev/vd?` in the guest). The volume
persists across `agent-sandbox remove`, preserving pulled images and build
cache; the CLI prints the `msb volume rm <project>-docker-data` cleanup
command on removal.

`docker.dataVolumeSize` is validated at registry load (`^[0-9]+[MG]$`,
minimum 1024 MiB). Docker support requires the stock `agent-sandbox:latest`
image; pairing `docker.enabled: true` with a custom image fails fast at
create time with an actionable error.

### Per-boot daemon lifecycle

The microVM has no init system, so `dockerd` is not started automatically.
The `/usr/local/bin/docker-up` helper starts it on demand: a no-op when
`docker info` already answers; otherwise it starts `dockerd` in the
background (log at `/tmp/dockerd.log`) and waits up to 60s for readiness.
Because the rootfs is ephemeral across stop/start (only named volumes
persist), the daemon must be re-started each boot — pulled images survive
only because they live on the data volume.

### Registry egress

Docker Hub pulls need `auth.docker.io`, `registry-1.docker.io`, and the
blob CDN `production.cloudfront.docker.com` (the legacy
`production.cloudflare.docker.com` variant is also documented) in
`network.allow` — `docker.enabled` does not imply any egress.

## Sandbox Lifecycle

```
agent-sandbox build          → docker build + msb image load
agent-sandbox project add    → write ~/.agent-sandbox/projects.json
agent-sandbox create         → Sandbox.builder() + .create() (+ /var/lib/docker volume if docker.enabled)
agent-sandbox start          → msb start <name>
agent-sandbox shell          → Sandbox.attachShell()
agent-sandbox exec           → Sandbox.execWith()
agent-sandbox opencode/codex/pi → Sandbox.attach("opencode"/"codex"/"pi")
docker-up (inside sandbox)  → start dockerd manually per boot (no init system)
agent-sandbox stop           → msb stop <name>
agent-sandbox restart        → stop + start
agent-sandbox remove         → msb remove <name> (preserves <project>-docker-data volume)
agent-sandbox list           → msb list --format json
agent-sandbox doctor         → health checks
agent-sandbox project list   → read registry
agent-sandbox project remove → remove from registry
```

## CLI Implementation

The CLI is a TypeScript application run via [Bun](https://bun.sh/):

- **Entry point**: `src/cli.ts` — uses `commander` for CLI framework
- **Commands**: implemented in `src/commands/` as async functions
- **Library code**: in `src/lib/` — sandbox lifecycle, network policy
  builder, secrets resolver, config loader
- **Type system**: `src/types.ts` defines `ProjectConfig`, `SecretEntry`,
  `NetworkConfig`, etc.

The `bin/agent-sandbox` launcher is a thin bash wrapper that delegates to
`bun run src/cli.ts`.
