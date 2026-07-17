#!/usr/bin/env bash
# Agent sandbox container entrypoint.
# Seeds /root from staging on first start, then execs the supplied command.
# Never overwrites user-modified configuration after the first initialization.
set -euo pipefail

MARKER="/root/.agent-sandbox-initialized"
STAGING="/opt/agent-sandbox"

if [[ ! -f "$MARKER" ]]; then
  echo "[agent-sandbox] First start: seeding /root from staging..." >&2

  # Create required directories
  mkdir -p /root/.local/share /root/.config/mise /root/.cache /root/.npm /root/.cargo /root/.local/bin

  # Copy pre-built mise tools from staging (outside /root, survives volume mount).
  # Use cp -rp (preserve mode/ownership/timestamps) NOT cp -a (which also preserves
  # xattrs). Image-layer xattrs cause "Permission denied" on subsequent volume reads
  # with rootless Podman on macOS/libkrun.
  cp -rp "$STAGING/mise-data/." /root/.local/share/mise/

  # Copy global mise config
  cp -p "$STAGING/config.toml" /root/.config/mise/config.toml

  # Copy default bashrc
  cp -p "$STAGING/bashrc" /root/.bashrc

  # Set up SSH authorized_keys if a public key was provided.
  # The key is passed via AGENT_SSH_PUBKEY env var by the bin/agent-sandbox CLI.
  if [[ -n "${AGENT_SSH_PUBKEY:-}" ]]; then
    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    echo "$AGENT_SSH_PUBKEY" > /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
  fi

  # Create .bash_profile to source .bashrc for SSH login shells.
  # Without this, mise activation in .bashrc is skipped when SSHing in.
  cat > /root/.bash_profile <<'BASH_PROFILE'
if [[ -f ~/.bashrc ]]; then
  source ~/.bashrc
fi
BASH_PROFILE

  # Write initialization marker LAST (only after all seeding succeeds)
  touch "$MARKER"

  echo "[agent-sandbox] Seeding complete." >&2
fi

# Generate SSH host keys if they don't exist (idempotent).
ssh-keygen -A 2>/dev/null || true

# Start sshd if SSH is enabled (default: enabled).
if [[ "${AGENT_SSH:-1}" == "1" ]]; then
  mkdir -p /run/sshd
  /usr/sbin/sshd
fi

exec "$@"
