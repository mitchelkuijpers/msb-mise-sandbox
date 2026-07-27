# mise-msb

A stateless Bun/TypeScript wrapper that turns layered TOML configuration
into inspectable `mise` and `msb` commands. Built on top of
[microsandbox](https://github.com/microsandbox/microsandbox) for microVM
isolation and TLS-intercepting secret injection, but without a custom SDK
or central project registry.

## Why

The previous CLI wrapped the microsandbox TypeScript SDK directly and
stored per-project configuration in a central `~/.agent-sandbox/projects.json`
registry. This release replaces both with a thin wrapper:

- **Layered TOML configuration** — built-in defaults → personal defaults
  at `~/.config/mise-msb/config.toml` → checked-in `.sandbox.toml` → CLI
  overrides.
- **Transparent `--print`** — every lifecycle command can show the
  generated `msb` argv without executing it.
- **No central registry** — projects self-describe in `.sandbox.toml`.
- **OCI image built from `mise.toml`** — `mise oci build` produces a
  layered OCI image directly from the project's tool versions.

## Features

- **Layered TOML configuration** — merge built-in defaults, personal
  defaults, project config, and CLI overrides deterministically.
- **Deny-by-default network opt-in** — projects explicitly set
  `network.defaultEgress = "deny"` to enable allowlist-based egress.
- **Secret references, never values** — TOML names source env vars and
  allowed hosts; the wrapper emits `--secret SOURCE_ENV@HOST` so values
  stay in the host environment.
- **Generic lifecycle commands** — `build`, `create`, `run`, `shell`,
  `exec`, `start`, `stop`, `remove`, `list`.
- **Idempotent install** — `mise-msb install [--force]` symlinks the
  wrapper into `~/.local/bin` without editing shell startup files.

## Prerequisites

- **macOS** (or Linux with KVM support) for running sandboxes
- **Bun ≥ 1.2** — `curl -fsSL https://bun.sh/install | bash`
- **`msb` CLI** — install via `mise use -g npm:microsandbox` or
  `brew install microsandbox`
- **A Linux builder image** that contains a recent mise with experimental
  OCI support (the default `build.builderImage` is `ubuntu:24.04`)

## Quick Start

```bash
# Install Bun dependencies (none required — the wrapper has zero runtime deps)
bun install

# Symlink the wrapper into ~/.local/bin (idempotent)
bun run install

# Optional: configure personal defaults at ~/.config/mise-msb/config.toml
mkdir -p ~/.config/mise-msb
$EDITOR ~/.config/mise-msb/config.toml

# Create a checked-in .sandbox.toml for your project
cat > .sandbox.toml <<'EOF'
[build]
from = "ubuntu:24.04"
tag = "my-project:dev"

[runtime]
cpus = 4
memory = "8G"

[network]
defaultEgress = "deny"
allow = ["github.com:tcp:443"]

[env]
NODE_ENV = "development"

[secrets.GITLAB_TOKEN]
from = "GITLAB_TOKEN"
hosts = ["gitlab.com"]
EOF

# Build the OCI image (Linux hosts use mise directly; macOS hosts route
# through an ephemeral msb builder microVM)
mise-msb build

# Inspect the generated msb create command without executing it
mise-msb create my-project --print

# Create and start the sandbox
mise-msb create my-project

# Run a command inside the sandbox
mise-msb exec my-project -- bun test

# Or open an interactive shell
mise-msb shell my-project

# Tear down
mise-msb stop my-project
mise-msb remove my-project
```

## Configuration Schema

See [`docs/usage.md`](docs/usage.md) for the full schema, precedence
rules, and merge semantics.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — wrapper design,
  layered configuration, build pipeline
- [`docs/usage.md`](docs/usage.md) — CLI reference, TOML schema, merge
  rules, migration from `projects.json`
- [`docs/security.md`](docs/security.md) — secret handling, network
  policy, threat model

## Security Notes

- **Secret values never enter the wrapper.** The TOML config names the
  source environment variable and the allowed hosts; `msb` reads the
  value from the host environment at sandbox start time.
- **Default egress is allow** — sandboxes can reach any destination
  unless the project explicitly sets `network.defaultEgress = "deny"`.
- **Published ports default to loopback** (`127.0.0.1`) unless the
  project specifies another bind address.
