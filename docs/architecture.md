# Architecture

## Rootless Podman vs Root Inside the Container

The agent sandbox runs on **rootless Podman** on macOS. This means:

- The Podman daemon runs as your user, not as root.
- Containers are created inside a Linux VM (Podman Machine) using libkrun or
  Apple Virtualization.framework.
- The container user is root (UID 0), but this is **not** host root.

In rootless Podman, container UID 0 maps to your host user UID. The container
root has no more privileges than your user account. Additional UIDs (1-65536)
map to a subordinate UID range allocated to your user.

This means:
- The agent can install packages as root inside the container.
- The agent cannot access host resources your user cannot access.
- The agent cannot gain host root through the container.

## Podman Machine on macOS

Podman on macOS requires a Linux VM because containers are Linux-native. The
architecture is:

```
macOS host
  └── Podman client (SSH)
      └── Podman Machine (Linux VM, Fedora CoreOS)
          └── Rootless Podman
              └── Agent sandbox container
                  ├── root user (UID 0, mapped to host user)
                  ├── sshd (port 22, key-only auth)
                  ├── mise tools (staged, seeded to /root volume)
                  ├── /workspace (bind mount of project directory)
                  └── /root (named volume, persistent)
```

The Podman client communicates with the VM over SSH. The VM runs rootless
Podman inside it. Containers are created and managed within the VM.

## Persistent Container Lifecycle

The container runs persistently with `sleep infinity` as its command. This
allows the user to start interactive tools with `podman exec` without
restarting the container each time.

```
agent-sandbox create .    → podman create (container exists, not running)
agent-sandbox start .     → podman start (container running, entrypoint seeds /root)
agent-sandbox shell .     → podman exec -it (interactive bash)
agent-sandbox opencode .  → podman exec -it (OpenCode TUI)
agent-sandbox stop .      → podman stop (container paused, state preserved)
agent-sandbox start .     → podman start (resume, no re-seeding)
agent-sandbox remove .    → podman rm (container gone, volume may persist)
```

## Bind Mount and Named Volume Behavior

### /workspace (bind mount)

The project directory is bind-mounted at `/workspace`. Files created by the
agent as root inside the container appear as owned by your host user on the
host (because container root = host user in rootless Podman). The bind mount
is writable — the agent can modify or delete project files.

### /root (named volume)

A named Podman volume is mounted at `/root`. This persists:
- mise tools (`/root/.local/share/mise`)
- mise config (`/root/.config/mise`)
- caches (`/root/.cache`)
- npm cache (`/root/.npm`)
- cargo cache (`/root/.cargo`)
- shell history (`/root/.bash_history`)
- agent sessions and configuration

**Volume shadowing**: mounting a named volume at `/root` hides any files
placed there during image creation. Podman does not auto-copy image content
into volumes (unlike Docker). The entrypoint solves this by seeding `/root`
from a staging directory (`/opt/agent-sandbox/`) on first start. A marker file
(`/root/.agent-sandbox-initialized`) prevents re-seeding on subsequent starts,
preserving user modifications.

## SSH and podman exec

The sandbox supports two access methods:

### podman exec (default, always available)

Interactive access through `podman exec -it` is the primary method. It is
simpler and more secure:

- No SSH keys to manage or expose.
- The container's only entry point is the Podman socket (rootless, on the host).
- Interactive TUIs (OpenCode, Codex) work through `podman exec -it` with full
  terminal support.

### SSH (for herdr --remote)

An SSH server (sshd) runs inside the container on port 22, enabled by default.
This allows `herdr --remote <container-name>` to attach as a thin client from
the host. `herdr --remote` auto-installs a matching herdr binary on the
container on first connect — the container only needs sshd, not herdr
pre-installed. The `bin/agent-sandbox` CLI manages the SSH lifecycle:

- Generates a dedicated ed25519 key pair at `~/.ssh/agent-sandbox-ed25519`.
- Publishes a host port (default 2222) to the container's port 22.
- Passes the public key into the container via the `AGENT_SSH_PUBKEY` env var.
- Adds an SSH config alias so `herdr --remote <container-name>` resolves.

SSH can be disabled with `AGENT_SSH=0`. It is automatically disabled when
`AGENT_NETWORK=none` (no network = no SSH).

## Entrypoint Seeding

The entrypoint (`/usr/local/bin/agent-entrypoint`) runs on every container
start. On first start (marker absent), it:

1. Creates required directories (`/root/.local/share`, `/root/.config/mise`,
   `/root/.cache`, `/root/.npm`, `/root/.cargo`, `/root/.local/bin`).
2. Copies pre-built mise tools from `/opt/agent-sandbox/mise-data` to
   `/root/.local/share/mise` using `cp -rp` (preserves permissions, not xattrs).
3. Copies the global mise config to `/root/.config/mise/config.toml`.
4. Copies the default bashrc to `/root/.bashrc`.
5. Writes the initialization marker last (only after all copies succeed).

On subsequent starts (marker present), the entrypoint skips seeding and
directly execs the command. This preserves user-installed tools and
configuration changes.

## Future: Credential Proxy

The architecture leaves room for a future credential-injecting egress proxy:

```
agent container
    ↓ internal network
credential proxy
    ↓ authenticated outbound request
external API
```

This would allow the agent to access external APIs without credentials being
stored inside the container. The `AGENT_PROXY_URL` environment variable is
reserved for this future feature.
