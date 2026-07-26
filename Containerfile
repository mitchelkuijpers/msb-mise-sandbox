# Agent sandbox container image
# Ubuntu 24.04 base with mise-managed development tools.
# Microsandbox-ready OCI image — no entrypoint, container boots directly.
#
# Built in OCI image format. The SHELL directive is ignored in OCI format,
# so RUN commands that use pipes set pipefail explicitly.

FROM docker.io/library/ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Runtime environment
ENV HOME=/root
ENV MISE_DATA_DIR=/root/.local/share/mise
ENV MISE_CONFIG_DIR=/root/.config/mise
ENV MISE_TRUSTED_CONFIG_PATHS=/workspace
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

# Agent configuration
COPY mise.toml /root/.config/mise/config.toml

# Install mise tools. ENV vars already point to /root paths used at runtime.
RUN mise trust /root/.config/mise/config.toml && mise install

# Verify tools installed correctly.
# Build fails if any tool is missing or broken.
RUN mise exec -- bash -c 'node --version && python --version && opencode --version && codex --version && pi --version'

# Docker CE engine, CLI, containerd, and buildx/compose plugins from Docker's
# official apt repository. iptables is dockerd's firewall backend inside the
# microVM. The daemon is never started at build time.
RUN apt-get update \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       iptables \
       docker-ce \
       docker-ce-cli \
       containerd.io \
       docker-buildx-plugin \
       docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Daemon startup helper — the microVM has no init system, so dockerd is
# started manually per boot via `docker-up`.
COPY scripts/docker-up.sh /usr/local/bin/docker-up
RUN chmod +x /usr/local/bin/docker-up

# Verify Docker binaries. Build fails if any is missing or broken.
# Binaries only — never start the daemon at build time.
RUN docker --version && dockerd --version && docker buildx version && docker compose version

# No entrypoint — microsandbox boots the image directly.
