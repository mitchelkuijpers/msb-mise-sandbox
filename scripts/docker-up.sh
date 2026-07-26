#!/usr/bin/env bash
# docker-up — start the Docker daemon inside the agent sandbox.
#
# The microVM has no init system, so dockerd is started manually per boot.
# Idempotent: succeeds without action when the daemon already answers.
#
# dockerd needs a disk-backed /var/lib/docker (its overlay2 storage driver
# cannot stack on the sandbox's overlay rootfs). Enable it per project with
# docker.enabled: true in ~/.agent-sandbox/projects.json.
set -euo pipefail

DOCKERD_LOG=/tmp/dockerd.log
READY_TIMEOUT_S=60

# Already running? Nothing to do.
if docker info >/dev/null 2>&1; then
  echo "dockerd is already running."
  exit 0
fi

# /var/lib/docker must be a real mount, not the overlay rootfs.
fstype="$(awk '$2 == "/var/lib/docker" { print $3 }' /proc/mounts)"
if [[ -z "$fstype" || "$fstype" == "overlay" ]]; then
  cat >&2 <<'EOF'
ERROR: /var/lib/docker is not a disk-backed volume.
dockerd's overlay2 storage driver cannot run on the sandbox's overlay rootfs.

Fix: set "docker": { "enabled": true } in the project's config in
~/.agent-sandbox/projects.json, then remove and re-create the sandbox.
EOF
  exit 1
fi

echo "Starting dockerd (log: $DOCKERD_LOG)…"
dockerd >"$DOCKERD_LOG" 2>&1 &
dockerd_pid=$!

for ((i = 1; i <= READY_TIMEOUT_S; i++)); do
  if docker info >/dev/null 2>&1; then
    echo "dockerd is ready."
    exit 0
  fi
  if ! kill -0 "$dockerd_pid" 2>/dev/null; then
    echo "ERROR: dockerd exited during startup. Log follows:" >&2
    cat "$DOCKERD_LOG" >&2
    exit 1
  fi
  sleep 1
done

echo "ERROR: dockerd did not become ready within ${READY_TIMEOUT_S}s. Log follows:" >&2
cat "$DOCKERD_LOG" >&2
exit 1
