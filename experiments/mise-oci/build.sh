#!/usr/bin/env bash
# Build the agent sandbox image using mise oci.
#
# This is an experimental alternative to the conventional Containerfile.
# It requires mise with experimental features enabled and must be run on
# a Linux host (or inside a Linux container on macOS).
#
# Usage:
#   ./experiments/mise-oci/build.sh
#
# On macOS, build inside a Linux container:
#   podman run --rm -v "$PWD:/src" -w /src debian:bookworm bash -c '
#     apt-get update && apt-get install -y curl ca-certificates skopeo
#     curl https://mise.run | sh
#     ./experiments/mise-oci/build.sh
#   '
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="${AGENT_IMAGE:-localhost/agent-dev:latest}"
OUTPUT_DIR="$SCRIPT_DIR/mise-oci-output"

echo "[mise-oci] Building OCI image from mise.toml..."
echo "[mise-oci] Image: $IMAGE_NAME"
echo "[mise-oci] Output: $OUTPUT_DIR"

# Enable experimental features
export MISE_EXPERIMENTAL=1

# Build the OCI image layout
mise oci build \
  --from ubuntu:24.04 \
  --tag "$IMAGE_NAME" \
  -o "$OUTPUT_DIR" \
  "$SCRIPT_DIR/mise.toml"

echo "[mise-oci] OCI image layout built at: $OUTPUT_DIR"

# Load into Podman via skopeo
if command -v skopeo >/dev/null 2>&1; then
  echo "[mise-oci] Loading into Podman via skopeo..."
  skopeo copy "oci:$OUTPUT_DIR" "containers-storage:$IMAGE_NAME"
  echo "[mise-oci] Loaded: $IMAGE_NAME"
  echo "[mise-oci] Verify with: podman images | grep agent-dev"
else
  echo "[mise-oci] skopeo not found. Load manually:"
  echo "[mise-oci]   skopeo copy oci:$OUTPUT_DIR containers-storage:$IMAGE_NAME"
  echo "[mise-oci] Or use mise oci run:"
  echo "[mise-oci]   mise oci run --engine podman -it -- bash"
fi

echo "[mise-oci] Done."
