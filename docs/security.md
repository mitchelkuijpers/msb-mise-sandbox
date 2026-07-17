# Security Model

## Root Inside the Container Is Not Host Root

The most important security property: **root inside a rootless container is not
host root.** In rootless Podman, container UID 0 maps to your host user UID.
The container root has no more privileges than your user account.

This means:
- The agent can install packages and modify files inside the container.
- The agent cannot access host resources your user cannot access.
- The agent cannot escalate to host root through the container.
- `--security-opt=no-new-privileges` further prevents privilege escalation
  via setuid/setgid binaries inside the container.

## Writable Bind Mounts Are Still Dangerous

The project directory is bind-mounted at `/workspace` and is writable. The
agent can:
- Modify project files.
- Delete project files.
- Create new files that appear on the host.

This is necessary for the agent to do its job, but it means a buggy or
malicious agent can damage your project. Mitigations:
- Use Git for version control (commit before running the agent).
- Use Git worktrees for risky tasks (planned feature).
- Use disposable volumes for untrusted agents (planned feature).

## --privileged Must Not Be Used

The container is never started with `--privileged`. This would grant:
- All capabilities.
- Access to all host devices.
- The ability to mount host filesystems.
- Effectively, host root access.

The sandbox explicitly drops capabilities: SYS_ADMIN, SYS_MODULE, SYS_RAWIO,
SYS_BOOT, NET_ADMIN, SYS_TIME, SYSLOG. In rootless mode, these capabilities
are already absent, but the drop is defense-in-depth.

## Runtime Sockets Must Not Be Mounted

The sandbox never mounts:
- The Podman socket (`/run/podman/podman.sock`).
- The Docker socket (`/var/run/docker.sock`).

Mounting either would give the agent full control over all containers on the
host, effectively escaping the sandbox.

## Host Credentials Must Not Be Mounted

The sandbox never mounts:
- `~/.ssh` (SSH keys).
- `~/.aws` (AWS credentials).
- `~/.config` (application credentials, including cloud CLIs).
- The host home directory.
- Any host credential directory.

Instead, authenticate interactively inside the container:
```bash
agent-sandbox shell .
# Inside the container:
opencode auth  # or equivalent
```

For temporary local testing, you can explicitly pass a named environment
variable. This is less secure and should not be used for long-term access.

## SSH Server Security

The sandbox runs an SSH server (sshd) inside the container for `herdr --remote`
thin-client access. The security model:

- **Key-only authentication.** `PasswordAuthentication no`, `UsePAM no`,
  `PermitRootLogin prohibit-password`. No passwords are accepted.
- **Dedicated key pair.** The CLI generates a separate ed25519 key at
  `~/.ssh/agent-sandbox-ed25519`. Host SSH keys (`~/.ssh/id_*`) are never
  used or mounted.
- **No host credentials mounted.** Only the public key content is passed via
  the `AGENT_SSH_PUBKEY` environment variable. The private key never enters
  the container.
- **Host keys are per-container.** SSH host keys are generated at runtime
  by the entrypoint, not baked into the image. They change on container
  recreation. The SSH config uses `StrictHostKeyChecking no` and
  `UserKnownHostsFile /dev/null` because the target is a local container.
- **No forwarding.** `AllowTcpForwarding no`, `X11Forwarding no`,
  `GatewayPorts no`, `PermitTunnel no`.
- **Disable when not needed.** Set `AGENT_SSH=0` to turn off the SSH server
  entirely. It is also auto-disabled when `AGENT_NETWORK=none`.

## Network Access Is an Independent Risk

Network access allows the agent to:
- Download packages and tools.
- Exfiltrate data.
- Communicate with external APIs.

Use `AGENT_NETWORK=none` for fully isolated builds:
```bash
AGENT_NETWORK=none agent-sandbox create .
```

In this mode, the container has no network access. Tools must be pre-installed
or available in the image.

## Credential Hiding Does Not Equal Authority Restriction

Just because credentials are not mounted does not mean the agent cannot take
harmful actions. The agent can still:
- Modify or delete project files (writable bind mount).
- Install persistent backdoors in the container layer or volume.
- Consume excessive resources (limited by --memory, --cpus, --pids-limit).

Security is layered:
1. **Isolation**: rootless Podman, no --privileged, no socket mounts.
2. **Capability restriction**: --cap-drop, --security-opt=no-new-privileges.
3. **Resource limits**: --memory, --cpus, --pids-limit.
4. **Network control**: AGENT_NETWORK=none for isolation.
5. **Credential isolation**: no host credential mounts, env allowlist.
6. **Workspace safety**: Git worktrees or disposable volumes for risky tasks.

## Use Git Worktrees or Disposable Volumes for Risky Tasks

For untrusted agents or risky operations:
- **Git worktree mode** (planned): creates a separate worktree so the agent
  cannot modify the main working directory.
- **Volume mode** (planned): runs the agent entirely inside a named volume,
  with explicit export of changes back to the host.

These modes are documented as follow-up features. The initial implementation
fully supports bind mode.
