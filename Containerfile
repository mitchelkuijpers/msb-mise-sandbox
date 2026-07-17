# Agent sandbox container image
# Ubuntu 24.04 base with mise-managed development tools.
# The container runs as root; the host uses rootless Podman.
# See docs/architecture.md for the rootless-vs-root-in-container explanation.
#
# Built in OCI image format (Podman default). The SHELL directive is ignored
# in OCI format, so RUN commands that use pipes set pipefail explicitly.

FROM docker.io/library/ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Runtime environment
ENV HOME=/root
ENV MISE_DATA_DIR=/root/.local/share/mise
ENV MISE_CONFIG_DIR=/root/.config/mise
ENV PATH=/root/.local/bin:/root/.local/share/mise/shims:${PATH}

WORKDIR /workspace

# System dependencies needed to bootstrap and use mise, plus useful
# networking and diagnostic tools. Do NOT install Node, Python, Go, or other
# developer tools here — those are managed through mise.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash \
      build-essential \
      ca-certificates \
      curl \
      file \
      git \
      jq \
      less \
      openssh-client \
      openssh-server \
      pkg-config \
      procps \
      rsync \
      sudo \
      tar \
      unzip \
      xz-utils \
      zip \
      vim-tiny \
      dnsutils \
      iproute2 \
      iputils-ping \
      netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Install mise to /usr/local/bin (outside /root, survives volume mount).
# Download to a file first (OCI format uses /bin/sh which lacks pipefail,
# so a bare pipe would not fail if curl errored).
RUN curl -fsSL https://mise.run -o /tmp/mise-install.sh \
    && MISE_INSTALL_PATH=/usr/local/bin/mise sh /tmp/mise-install.sh \
    && rm -f /tmp/mise-install.sh \
    && mise --version

# Stage agent configuration outside /root (survives named-volume mount at /root).
# Build-time mise dirs point to staging; runtime ENV points to /root (seeded by entrypoint).
ARG MISE_BUILD_DATA_DIR=/opt/agent-sandbox/mise-data
ARG MISE_BUILD_CONFIG_DIR=/opt/agent-sandbox
COPY mise.toml /opt/agent-sandbox/config.toml
COPY config/bashrc /opt/agent-sandbox/bashrc
COPY config/sshd_config /etc/ssh/sshd_config.d/agent-sandbox.conf
COPY config/entrypoint.sh /usr/local/bin/agent-entrypoint
RUN chmod +x /usr/local/bin/agent-entrypoint

# Install mise tools to staging directory (outside /root).
# At runtime the entrypoint copies these into the /root volume on first start.
RUN MISE_DATA_DIR=$MISE_BUILD_DATA_DIR \
    MISE_CONFIG_DIR=$MISE_BUILD_CONFIG_DIR \
    mise trust /opt/agent-sandbox/config.toml \
    && MISE_DATA_DIR=$MISE_BUILD_DATA_DIR \
    MISE_CONFIG_DIR=$MISE_BUILD_CONFIG_DIR \
    mise install

# Verify tools installed correctly during build (against staging).
# Build fails if any tool is missing or broken. A single mise exec sets up
# the environment once and runs all checks within it.
RUN MISE_DATA_DIR=$MISE_BUILD_DATA_DIR \
    MISE_CONFIG_DIR=$MISE_BUILD_CONFIG_DIR \
    mise exec -- bash -c 'node --version && python --version && opencode --version && codex --version'

# SSH server (sshd) runs for herdr --remote thin-client attach.
# herdr --remote auto-installs a matching herdr binary on the remote host
# on first connect, so we do not bake herdr into the image.
# The container also supports podman exec for direct interactive access.
# The entrypoint starts sshd as a background process, then execs the command.
ENTRYPOINT ["/usr/local/bin/agent-entrypoint"]
CMD ["sleep", "infinity"]
