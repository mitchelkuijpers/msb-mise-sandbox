# mise-msb

Run development environments and agent workloads inside disposable
microVMs — your project mounted live at the same absolute path as on the host,
your secrets scoped to the hosts that need them, nothing reachable that you
didn't declare.

`mise-msb` builds that sandbox from a single checked-in `.sandbox.toml`,
on top of [microsandbox](https://github.com/microsandbox/microsandbox).

## Prerequisites

- **macOS** (or Linux with KVM)
- **[mise](https://mise.jdx.dev)** — provides Bun via this repo's `mise.toml`
- **`msb` CLI** — `brew install microsandbox` or `mise use -g npm:microsandbox`
- **Docker** — host-side, only for the one-time `mise-msb setup`

## Install

```bash
mise install          # install pinned tools (bun)
bun install           # dev dependencies only — zero runtime deps
mise run install      # symlink mise-msb into ~/.local/bin
```

If `~/.local/bin` is not on your `$PATH`, the install prints a one-line hint.

## Setup (once)

```bash
mise-msb setup        # build + load the stock Ubuntu image (uses host Docker)
```

Stock image contains pinned mise, Docker CE, and prerequisites. Re-run with
`--force` to rebuild.

## Use in a project

Create a checked-in `.sandbox.toml` in the project root. The project mount is
built in, so only declare project-specific settings:

```toml
[env]
NODE_ENV = "development"

[secrets.GITLAB_TOKEN]
from = "GITLAB_TOKEN"
hosts = ["gitlab.com"]
```

The wrapper mounts the project read-write at the same absolute path inside
the guest and uses that path as its workdir. For example,
`/Users/alice/Development/foo` stays `/Users/alice/Development/foo`. Edits
are visible on both sides, and tools that key caches, history, or memories by
absolute path see the same project identity.

To opt into a different guest path, override the built-in mount:

```toml
[mounts.project]
target = "/workspace"
```

The workdir follows that target unless top-level `workdir` is set explicitly.
Mount changes require recreating the sandbox.

Then:

```bash
mise-msb create my-project     # create + bootstrap (docker-up, mise bootstrap, mise install)
msb exec my-project -- bun test
msb ssh my-project             # interactive shell (raw msb; wrapper has no shell command)
msb stop my-project && msb remove my-project   # teardown; volumes preserved
```

Runtime control (`exec`, `ssh`, `start`, `stop`, `remove`, `list`) is plain
`msb` — the wrapper intentionally only covers setup/create/config.

## Personal setup (optional)

Two opt-in per-user files under `~/.config/mise-msb/` (both XDG-aware).

**`config.toml`** — defaults applied to every sandbox, merged under the
project's `.sandbox.toml`. Useful for runtime sizing, additional mounts, env,
and secrets. The built-in same-path project mount already applies to every
sandbox, so you do not need to repeat it here:

```toml
# ~/.config/mise-msb/config.toml
[runtime]
cpus = 8
memory = "16G"
rootDisk = "8G"

# Mount a host dir into every sandbox
[mounts.agent]
kind = "dir"
source = "~/.config/my-agent"
target = "/root/.config/my-agent"

[env]
MY_FLAG = "1"

[secrets.MY_API_KEY]
from = "MY_API_KEY"          # host env var
hosts = ["api.example.com", "*.example.com"]
```

**`bootstrap/mise.toml`** — provision every sandbox with your own tools and
dotfiles before project tools install. Runs `mise bootstrap` on create;
editing the file re-runs provisioning on the next `create` (content is
hashed for change detection):

```toml
# ~/.config/mise-msb/bootstrap/mise.toml
[tools]
node = "lts"
"npm:some-cli" = "latest"
"github:owner/repo" = "latest"

[bootstrap.packages]
"apt:ripgrep" = "latest"
"apt:fd-find" = "latest"

# Symlink dotfiles from a `dotfiles/` dir next to this file
[settings]
dotfiles.root = "/etc/mise-msb/personal/dotfiles"

[dotfiles]
"~/.gitconfig" = { mode = "symlink" }
```

The bootstrap directory is mounted writable at `/etc/mise-msb/personal`, so
`mise use -g` inside a sandbox writes back to this file.

## Documentation

- [docs/usage.md](docs/usage.md) — config layers and `.sandbox.toml` schema
- [docs/architecture.md](docs/architecture.md) — design
- [docs/security.md](docs/security.md) — secrets, network policy, threat model
