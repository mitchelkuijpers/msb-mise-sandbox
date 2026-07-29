# Usage

## Commands

| Command | Purpose |
|---|---|
| `setup [--print] [--force]` | Build and load the local stock runtime image |
| `create <name> [--print]` | Create a sandbox from the merged config |
| `run <name> [-- cmd...]` | Create (or start) and exec the configured command |
| `shell <name> [--print]` | Attach an interactive shell |
| `exec <name> -- cmd...` | Execute a single command in a running sandbox |
| `start <name>` | Start a stopped sandbox |
| `stop <name>` | Stop a running sandbox |
| `remove <name>` | Remove a sandbox |
| `list` | List sandboxes |
| `config` | Print the effective merged configuration |
| `signing init [--force]` | Generate the sandbox commit-signing keypair |
| `install [--force]` | Symlink `~/.local/bin/mise-msb` |

All lifecycle commands accept `--print` (alias `--dry-run`) to print the
generated `msb` argv without executing it. Multi-step commands like
`run` print each step in execution order.

## Quick Start

```bash
# Build and load the local stock Ubuntu image (one-time setup)
mise-msb setup

# Create a stock-mode sandbox (Docker + mise bootstrap automatically)
mise-msb create my-project

# Run commands
mise-msb exec my-project -- bun test
mise-msb shell my-project
```

## Mounting Your Project

Sandboxes never mount host paths implicitly, so a fresh sandbox starts with
an **empty `/workspace`**. Almost every project wants its directory
live-mounted there — stock sandboxes default `--workdir` to `/workspace` and
the bootstrap runs `mise install` in it. Add this to your project's
`.sandbox.toml`:

```toml
[mounts.workspace]
kind = "dir"
source = "."
target = "/workspace"
```

`source = "."` resolves to the project root (the directory containing
`.sandbox.toml`). Edits on either side are visible immediately; nothing is
copied. Mounts are fixed at creation time, so recreate the sandbox after
adding one (`mise-msb remove <name> && mise-msb create <name>`).

## Configuration Layers

Configuration is loaded from up to three layers, merged in order:

1. **Built-in defaults** (always applied)
2. **Personal defaults** at `~/.config/mise-msb/config.toml` (optional)
3. **Project config** at `<project>/.sandbox.toml` (optional)
4. **CLI overrides** (highest precedence)

Pass `--config <absolute-path>` to skip project discovery.

### Merge Rules

| Section | Strategy |
|---|---|
| Scalar fields (`stock.imageMode`, `runtime.cpus`, etc.) | Last non-empty wins |
| `env` (record) | Deep merge; later keys override earlier |
| Named `mounts`, `ports`, `secrets` tables | Merge by name; later entry replaces earlier |
| `network.allow` (array of strings) | Append + dedupe unless `network.inherit = false`, in which case overlay replaces |
| `network.defaultEgress` | Last non-null value wins |
| `command.argv` (array) | Replace (does not concatenate) |
| `labels` (record) | Deep merge; later keys override earlier |

Identical inputs always produce identical merged output — the merge is a
pure function and the resulting argv is byte-identical for the same
config.

## Schema Reference

### `[stock]`

```toml
[stock]
imageMode = "stock"            # "stock" (default) or "custom"
customImage = "my-project:dev" # required when imageMode = "custom"
dockerDataSize = "10G"         # Docker data volume size (M or G suffix)
```

Stock mode uses the wrapper's versioned local stock image (`mise-msb-base:v2`),
injects persistent named volumes for mise (`<sandbox>-mise-v1:/mise`) and
Docker data (`<sandbox>-docker-data:/var/lib/docker`), and runs Docker
readiness and mise bootstrap automatically.

Custom mode requires an explicit image reference that the user has already
made available to microsandbox. Custom images own their Docker and bootstrap
compatibility.

### `[runtime]`

```toml
[runtime]
cpus = 4                # positive integer
memory = "8G"           # M or G suffix
```

### `[network]`

```toml
[network]
defaultEgress = "deny"   # "allow" (default) or "deny"
allow = ["github.com:tcp:443"]
inherit = true           # when false, overlay's allow replaces inherited
```

Each entry uses `<host>:<protocol>:<port>` syntax. Suffix matches are
expressed as `*.example.com:tcp:443`. The wrapper translates each rule
to `--net-rule allow@<host>:<proto>:<port>`.

### `[env]`

```toml
[env]
NODE_ENV = "development"
DEBUG = "1"
```

Keys must be valid environment variable identifiers (`[A-Za-z_][A-Za-z0-9_]*`).

### `[mounts.<name>]`

```toml
[mounts.workspace]
kind = "dir"        # dir | file | disk | named
source = "."        # host path (or named volume name)
target = "/workspace"  # absolute guest path
options = "ro"      # optional, forwarded verbatim

[mounts.cache]
kind = "named"
source = "cache-vol"
target = "/root/.cache"

[mounts.data]
kind = "disk"
source = "data-vol"
target = "/data"
size = "10G"        # disk-backed named volume capacity
```

In stock mode, `/mise` and `/var/lib/docker` are reserved for wrapper-managed
persistent state. Declaring an explicit mount with either target in stock mode
fails validation.

### `[ports.<name>]`

```toml
[ports.dev]
hostPort = 8080
guestPort = 8080    # defaults to hostPort
protocol = "tcp"    # "tcp" (default) or "udp"
bind = "127.0.0.1"  # defaults to loopback
```

### `[secrets.<name>]`

```toml
[secrets.GITLAB_TOKEN]
from = "GITLAB_TOKEN"           # source host env var
hosts = ["gitlab.com"]          # allowed destination hosts
```

The wrapper verifies `from` is present in the host environment without
reading its value, then emits `--secret GITLAB_TOKEN@gitlab.com`.

The table key (e.g. `GITLAB_TOKEN`) is the **guest-facing** environment
variable name. It must be a valid environment variable identifier
(`[A-Za-z_][A-Za-z0-9_]*`) — decorative keys such as
`personal-github-token` are rejected. The `from` field is the
**host-side** variable whose value microsandbox will substitute into
allowed TLS destinations.

#### Mapping a personal host source to a conventional guest tool variable

```toml
[secrets.OPENCODE_API_KEY]
from = "OPENCODE_API_KEY_PERSONAL"
hosts = ["opencode.ai"]
```

When the table key differs from `from`, the wrapper emits:

```
--env OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL
--secret OPENCODE_API_KEY_PERSONAL@opencode.ai
```

The guest sees `OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL`. Tools
that read `OPENCODE_API_KEY` send the literal `$MSB_OPENCODE_API_KEY_PERSONAL`
to an allowed host and microsandbox substitutes the real
`OPENCODE_API_KEY_PERSONAL` value at the TLS boundary only. The wrapper
never reads, copies, or logs the real value.

A configured secret entry that already uses the same name as its source
(e.g. `secrets.GITLAB_TOKEN.from = "GITLAB_TOKEN"`) continues to emit
only `--secret GITLAB_TOKEN@gitlab.com` — no bridge is needed because the
source-named placeholder is already exposed to the guest by `--secret`.

If a `[secrets.<name>]` key overlaps with an `[env]` entry, the secret
mapping wins authoritatively: the bridge replaces the literal env value
in argv so a real value never enters the wrapper's command line.

### `[labels]`

```toml
[labels]
team = "platform"
```

### `[signing]`

```toml
[signing]
enabled = true
key = "~/.config/mise-msb/signing/id_ed25519_sandbox"
```

Enables SSH commit signing inside the sandbox with a dedicated,
passphrase-less ed25519 key. Generate the keypair with
`mise-msb signing init`, then register the printed public key as an SSH
**signing** key with your forge (GitHub/GitLab) — the command prints exact
instructions and the `allowed_signers` line for commit verification.

- `enabled` (boolean, default `false`) — may be set in any layer; a project
  can opt in while the operator's personal layer supplies the key.
- `key` (host path, `~` is expanded) — must resolve (symlinks included) to
  a path under `~/.config/mise-msb/signing/`. Paths anywhere else (e.g.
  `~/.ssh/id_ed25519`) are rejected, so the feature can never be pointed at
  an authentication key. Validation runs before any `msb` invocation, in
  normal and `--print` modes, and fails closed: permissions must be ≤ 0600,
  the key must be ed25519 and unencrypted, and the sibling `.pub` must match.

When enabled, `create` argv gains four deterministic additions:

- `--mount-file <key>:/etc/mise-msb/signing/id_ed25519_sandbox:ro`
- `--mount-file <key>.pub:/etc/mise-msb/signing/id_ed25519_sandbox.pub:ro`
- `--copy <tmp>:/etc/mise-msb/gitconfig` — a wrapper-generated gitconfig
- `--env GIT_CONFIG_GLOBAL=/etc/mise-msb/gitconfig`

The generated gitconfig owns the guest's global git slot. It pins
`gpg.format = ssh`, `user.signingkey` (the guest pubkey path), and
`commit.gpgsign = true`, plus the committer identity (`user.name` /
`user.email`) resolved from the host's git configuration. When a host
`~/.gitconfig` mount is configured, the generated file begins with an
`[include]` of it — the mount is retargeted to the neutral path
`/etc/mise-msb/host-gitconfig` (read-only) — so host settings flow through
while the pinned entries override any inherited signing configuration.
Guest key placement is deliberately outside `~/.ssh`: the key can sign
commits but no guest tool can pick it up for authentication. Key material
travels by read-only mount only — never via `--copy`, `--env`, or argv —
so it cannot enter the guest writable layer or any sandbox snapshot.

## Personal Bootstrap

Optional per-developer mise bootstrap at `~/.config/mise-msb/bootstrap/mise.toml`:

```toml
# ~/.config/mise-msb/bootstrap/mise.toml
[tools]
ripgrep = "latest"

[bootstrap]
packages = ["fzf"]
dotfiles = ["~/.gitconfig"]
hooks = ["setup-personal-aliases"]
```

When present, the wrapper mounts the containing directory read-only at
`/etc/mise-msb/personal`, sets `MISE_GLOBAL_CONFIG_FILE`, and runs
personal bootstrap before project tool installation.

Personal bootstrap content is content-hashed for change detection. A new
sandbox or changed bootstrap content re-runs full personal provisioning;
unchanged warm-start invocations skip it.

## Stock Runtime Behaviour

### Image Setup

`mise-msb setup` builds the repository-owned Containerfile with host Docker,
saves the resulting archive, and loads it with `msb image load`. Warm setup
skips when the expected generation is already loaded. `setup --force` rebuilds.

### Bootstrap Stages

After `create` or `start`, stock mode runs these stages in order:

1. **Docker readiness** — `docker-up` starts dockerd and waits for success
2. **Personal bootstrap** — runs `mise-msb-bootstrap personal <hash>` when
   personal configuration exists (skips on unchanged warm-start)
3. **Project bootstrap** — `mise install --locked` when `mise.lock` exists,
   otherwise `mise install`

Any stage failure stops the sequence and propagates the exit code.

### Persistent Volumes

Stock mode creates two named volumes derived from the sandbox identity:

| Volume | Target | Type | Purpose |
|---|---|---|---|
| `<sandbox>-mise-v1` | `/mise` | Directory-backed | Mise data, cache, config, state, shims |
| `<sandbox>-docker-data` | `/var/lib/docker` | Disk-backed (10G default) | Docker images, containers, build cache |

Volumes survive `remove`. The remove command prints each preserved name
with a copyable `msb volume remove` command for manual cleanup.

### Stock Image Preflight

If the stock image is not loaded when creating or running a stock sandbox,
the command fails with a copyable `mise-msb setup` instruction.

## Print Mode

`--print` (alias `--dry-run`) outputs the generated `msb` argv without
executing it. Multi-step commands print each step in execution order,
separated by blank lines. Stock mode includes bootstrap stages in the
printed sequence.

```bash
$ mise-msb run my-project -- bun test --print
msb create mise-msb-base:v1 --name my-project --cpus 4 --memory 8G \
    --workdir /workspace --mount-named my-project-mise-v1:/mise \
    --mount-named my-project-docker-data:/var/lib/docker:kind=disk,size=10G

msb exec my-project -- docker-up

msb exec my-project -- mise-msb-bootstrap personal <hash>

msb exec my-project -- mise-msb-bootstrap project

msb exec my-project -- bun test
```

## Install

```bash
# Symlink ~/.local/bin/mise-msb → <repo>/bin/mise-msb
mise-msb install

# Replace an existing link or file at the destination
mise-msb install --force
```

The install command does not modify shell startup files. If
`~/.local/bin` is not on `$PATH`, a one-line hint is printed after a
successful install.

## Migration from `projects.json`

Projects previously stored in `~/.agent-sandbox/projects.json` should be
translated to per-project `.sandbox.toml` files:

```toml
# <project>/.sandbox.toml
[runtime]
cpus = 4
memory = "8G"

[network]
defaultEgress = "deny"
allow = ["gitlab.com:tcp:443"]

[secrets.GITLAB_TOKEN]
from = "GITLAB_TOKEN"
hosts = ["gitlab.com"]
```

Stock mode is the default — no `[stock]` section is required.

## Migration from `<project>:dev` builds

Projects that used `mise-msb build` and the `<project>:dev` image should:

1. Run `mise-msb setup` once to build and load the local stock image
2. Remove `[build]` sections from `.sandbox.toml` (now rejected by validation)
3. Use stock mode (default) for wrapper-managed Docker and mise bootstrap
4. Or select custom image mode with the externally built image reference

Named volumes from the old workflow remain intact but are no longer managed
by the wrapper.
