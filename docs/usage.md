# Usage

## Commands

| Command | Purpose |
|---|---|
| `build [--print]` | Build OCI image from project's `mise.toml` |
| `create <name> [--print]` | Create a sandbox from the merged config |
| `run <name> [-- cmd...]` | Create (or start) and exec the configured command |
| `shell <name> [--print]` | Attach an interactive shell |
| `exec <name> -- cmd...` | Execute a single command in a running sandbox |
| `start <name>` | Start a stopped sandbox |
| `stop <name>` | Stop a running sandbox |
| `remove <name>` | Remove a sandbox |
| `list` | List sandboxes |
| `config` | Print the effective merged configuration |
| `install [--force]` | Symlink `~/.local/bin/mise-msb` |

All lifecycle commands accept `--print` (alias `--dry-run`) to print the
generated `msb` argv without executing it. Multi-step commands like
`run` print each step in execution order.

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
| Scalar fields (`build.from`, `build.tag`, `runtime.cpus`, etc.) | Last non-empty wins |
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

### `[build]`

```toml
[build]
from = "ubuntu:24.04"          # base image for mise oci build
tag = "my-project:dev"          # local image tag (defaults to <name>:dev)
builderImage = "ubuntu:24.04"   # Linux image used on macOS for builds
```

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
source = "/srv/data.img"
target = "/data"
size = "10G"        # required for disk mounts
```

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

### `[labels]`

```toml
[labels]
team = "platform"
```

## Secret Configuration

The TOML schema for secrets contains **references only**:

- `from` — the host environment variable name (e.g. `GITLAB_TOKEN`).
- `hosts` — allowed destination hosts (e.g. `["gitlab.com"]`).

The wrapper:

1. Verifies `from` is set in the host environment. Missing variables
   cause a non-zero exit before any `msb` command runs.
2. Emits one `--secret FROM@HOST` argument per host.
3. Never reads, copies, logs, or places the secret value in argv.

The microsandbox runtime resolves the value from the inherited host
environment at sandbox start time. Inline `FROM=VALUE@HOST` syntax is
rejected by `msb` by design.

## Network Policy

The default egress policy is `allow` — sandboxes can reach any
destination unless the project explicitly sets `network.defaultEgress =
"deny"` and configures `network.allow`.

Secret hosts automatically receive network access: when a secret allows
`api.example.com`, the wrapper ensures an equivalent `--net-rule` exists
unless the project already specifies one.

## Migration from `projects.json`

Projects previously stored in `~/.agent-sandbox/projects.json` should be
translated to per-project `.sandbox.toml` files:

```jsonc
// ~/.agent-sandbox/projects.json (old)
{
  "projects": {
    "my-project": {
      "image": "agent-sandbox:latest",
      "gitlab": { "url": "https://gitlab.com", "tokenRef": "env:GITLAB_TOKEN" },
      "secrets": [
        { "env": "GITLAB_TOKEN", "from": "env:GITLAB_TOKEN", "allow": "gitlab.com" }
      ],
      "network": {
        "defaultEgress": "deny",
        "allow": ["gitlab.com:tcp:443"]
      },
      "resources": { "cpus": 4, "memory": "8G" }
    }
  }
}
```

becomes:

```toml
# <project>/.sandbox.toml
[build]
from = "ubuntu:24.04"

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

After migration, `~/.agent-sandbox/projects.json` can be deleted.

## Build Flow

### Linux hosts

```
mise oci build --from <base> --tag <tag> --output <layout>
tar -C <layout> -cf <image.tar> .
msb image load --input <image.tar> --tag <tag>
```

### macOS hosts

```
msb run <builder-image> \
    --mount-dir <project>:/workspace:ro \
    --mount-dir <output>:/out:rw \
    --env MISE_EXPERIMENTAL=1 \
    -- mise oci build --from <base> --tag <tag> --output /out/layout

tar -C <output>/layout -cf <output>/image.tar .
msb image load --input <output>/image.tar --tag <tag>
```

The macOS path runs `mise oci build` inside a Linux microVM to avoid
embedding host-native macOS binaries. The builder image defaults to
`ubuntu:24.04` and must contain a recent mise with experimental OCI
support.

Use `mise-msb build --print` to inspect the exact commands without
running them.

## Print Mode

`--print` (alias `--dry-run`) outputs the generated `msb` argv without
executing it. Multi-step commands print each step in execution order,
separated by blank lines.

```bash
$ mise-msb run my-project -- bun test --print
msb create my-project:dev --name my-project --cpus 4 --memory 8G \
    --workdir /workspace --env NODE_ENV=development --net-default deny

msb exec my-project -- bun test
```

Secret arguments contain source environment variable names only:

```bash
$ mise-msb create my-project --print
msb create my-project:dev --name my-project --secret GITLAB_TOKEN@gitlab.com ...
```

## Install

```bash
# Symlink ~/.local/bin/mise-msb → <repo>/bin/mise-msb
mise-msb install

# Replace an existing link or file at the destination
mise-msb install --force

# The wrapper refuses to recursively remove a directory at the destination,
# even with --force.
```

The install command does not modify shell startup files. If
`~/.local/bin` is not on `$PATH`, a one-line hint is printed after a
successful install.

A `mise run install` task in the tool repository's `mise.toml` invokes
the wrapper's `install` command, so `mise run install` in the repo
installs the tool.
