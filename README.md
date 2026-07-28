# mise-msb

A stateless Bun/TypeScript wrapper that turns layered TOML configuration
into inspectable `mise` and `msb` commands. Built on top of
[microsandbox](https://github.com/microsandbox/microsandbox) for microVM
isolation and TLS-intercepting secret injection, but without a custom SDK
or central project registry.

## Why

Stock image mode makes a usable development sandbox fast and repeatable
without per-project image builds or a macOS Linux builder microVM.
Developers run `mise-msb setup` once to build and load a local Ubuntu
stock image containing pinned mise, Docker CE, and common prerequisites.
Projects use `setup`-once provisioning with runtime tool installation
into persistent per-project volumes.

- **Layered TOML configuration** — built-in defaults → personal defaults
  at `~/.config/mise-msb/config.toml` → checked-in `.sandbox.toml` → CLI
  overrides.
- **Transparent `--print`** — every lifecycle command can show the
  generated `msb` argv without executing it.
- **No central registry** — projects self-describe in `.sandbox.toml`.
- **Stock image mode** — local Ubuntu stock image with Docker CE, mise,
  and runtime tool provisioning, no per-project image build.
- **Custom image mode** — for users who build and load their own image
  with external tooling.

## Prerequisites

- **macOS** (or Linux with KVM support) for running sandboxes
- **Bun ≥ 1.2** — `curl -fsSL https://bun.sh/install | bash`
- **`msb` CLI** — install via `mise use -g npm:microsandbox` or
  `brew install microsandbox`
- **Docker** — required on the host for `mise-msb setup` (not required
  at runtime after the stock image is loaded)

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

# Build and load the local stock image (once per stock-image generation)
mise-msb setup

# Create and start the sandbox (Docker and mise bootstrap automatically)
mise-msb create my-project

# Run a command inside the sandbox
mise-msb exec my-project -- bun test

# Or open an interactive shell
mise-msb shell my-project

# Tear down (sandbox removed; volumes preserved)
mise-msb stop my-project
mise-msb remove my-project
```

## Custom Image Mode

When stock mode does not fit, select custom image mode:

```toml
[stock]
imageMode = "custom"
customImage = "my-project:dev"
```

Custom images retain generic lifecycle behavior and are responsible
for their own Docker, bootstrap, and compatibility guarantees.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — wrapper design,
  layered configuration, stock runtime architecture
- [`docs/usage.md`](docs/usage.md) — CLI reference, TOML schema, merge
  rules, migration
- [`docs/security.md`](docs/security.md) — secret handling, network
  policy, threat model, host mount safety
