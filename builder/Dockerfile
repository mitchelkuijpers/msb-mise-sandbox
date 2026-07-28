# mise-msb builder image
#
# Used by `mise-msb build` on macOS to run `mise oci build` inside a Linux
# microVM. Also provides the tools needed for the custom-base handoff:
#
#   - mise      builds the final OCI image from mise.toml
#   - skopeo    imports the locally built base into the in-VM registry
#   - registry  a temporary loopback OCI registry (runs inside the VM)
#
# Build and load into msb:
#   mise run build-builder
#
# Or directly:
#   docker build --load -t mise-msb-builder:latest builder/

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    skopeo \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# Copy the registry binary from the official registry:2 image.
COPY --from=registry:2 /bin/registry /usr/local/bin/registry

# Minimal registry config — loopback only, filesystem storage.
RUN mkdir -p /etc/registry && \
    printf 'version: 0.1\nstorage:\n  filesystem:\n    rootdirectory: /tmp/registry\nhttp:\n  addr: 127.0.0.1:5000\n' \
    > /etc/registry/config.yml

# Install mise (latest, which is >= 2026.7.12).
RUN curl -fsSL https://mise.run | sh
ENV PATH="/root/.local/bin:${PATH}"

# Verify all tools are available at build time.
RUN mise --version && skopeo --version && registry --version
