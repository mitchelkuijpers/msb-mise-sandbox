# Architecture

## Overview

`mise-msb` is a stateless Bun/TypeScript wrapper that translates layered
TOML configuration into inspectable `msb` commands. The wrapper itself
does not implement sandbox lifecycle, secret injection, or network policy
— it delegates those to `msb`, which the runtime already provides.

Three properties:

1. **Transparency** — every command can be printed (`--print`) before
   execution, revealing the exact `msb` argv that will run.
2. **Statelessness** — no central project registry, no mutable global
   state. Projects self-describe in `.sandbox.toml`.
3. **Composability** — layered configuration (built-in → personal →
   project → CLI) merges deterministically and the merge function is
   independently unit-tested.

## Layered Configuration

```
┌─────────────────────────────────┐
│ Built-in defaults               │  src/config/types.ts (BUILTIN_DEFAULTS)
└─────────────────────────────────┘
                ↓
┌─────────────────────────────────┐
│ ~/.config/mise-msb/config.toml  │  personal defaults (optional)
└─────────────────────────────────┘
                ↓
┌─────────────────────────────────┐
│ <project>/.sandbox.toml         │  project config (optional, walked up from cwd)
└─────────────────────────────────┘
                ↓
┌─────────────────────────────────┐
│ CLI flag overrides              │  --print, --config <path>
└─────────────────────────────────┘
                ↓
        Effective SandboxConfig
```

Each layer is validated before merging. The merge function
(`src/config/merge.ts`) implements per-section rules documented in the
design and verified by unit tests in `tests/merge.test.ts`.

## Stock Image Setup

```
┌──────────────────────────────────────┐
│ mise-msb setup                       │
│   → docker build -t mise-msb-base:v{N}│
│   → docker save -o <archive>         │
│   → msb image load --input <archive> │
└──────────────────────────────────────┘
```

Setup is explicit and separate from lifecycle commands. Warm setup skips
when the expected generation is already loaded. The stock Containerfile
(`src/stock-image/Containerfile`) bakes in pinned mise, Docker CE,
common prerequisites, and versioned runtime helpers.

## Stock Lifecycle

```
mise-msb create <name>
    ↓
msb create mise-msb-base:v{N} --name <name> --mount-named <name>-mise-v1:/mise ...
    ↓
msb exec <name> -- docker-up                           (Docker readiness)
    ↓
msb exec <name> -- mise-msb-bootstrap personal <hash>  (personal bootstrap, optional)
    ↓
msb exec <name> -- mise-msb-bootstrap project          (project tools)
    ↓
msb exec <name> -- <user command>                      (upon exec/shell/run)
```

Stock mode runs lifecycle bootstrap stages after create or start. Any
stage failure stops the sequence and propagates the exit code.

## Personal Bootstrap

Optional per-developer bootstrap at `~/.config/mise-msb/bootstrap/mise.toml`:

```
~/.config/mise-msb/bootstrap/mise.toml  →  mounted at /etc/mise-msb/personal (ro)
                                             MISE_GLOBAL_CONFIG_FILE=/etc/mise-msb/personal/mise.toml
```

Content-hashed change detection avoids re-running personal provisioning
on unchanged warm starts. The hash lives in sandbox-local writable state,
not the persistent mise volume.

## Image Modes

| Mode | Image | Docker | Bootstrap | Use Case |
|---|---|---|---|---|
| `stock` (default) | `mise-msb-base:v{N}` | Managed | Managed | Normal development |
| `custom` | Explicit reference | User-owned | User-owned | Custom base, no wrapper build |

## Module Layout

```
src/
  mise-msb.ts               entry point
  stock-image/
    Containerfile            Ubuntu stock image with mise + Docker CE
    docker-up                Idempotent Docker startup helper
    mise-msb-bootstrap       Personal and project bootstrap helper
    constants.ts             Stock image tag, mount paths, env vars
  commands/
    dispatch.ts              hand-rolled CLI parser
    _shared.ts               load + apply CLI overrides
    setup.ts                 stock image setup command
    create.ts                create command (with stock bootstrap)
    run.ts                   run command (multi-step, with bootstrap)
    shell.ts                 shell command
    exec.ts                  exec command
    start.ts / stop.ts /     thin lifecycle delegations
    remove.ts / list.ts
    config.ts                print merged config
    signing.ts               signing init command (keypair genesis)
    install.ts               symlink installer
    lifecycle.ts             internal helpers
  signing/
    paths.ts                 host/guest signing path constants (XDG-aware)
    validate.ts              fail-closed signing key validation (ssh-keygen)
    gitconfig.ts             generated guest gitconfig (identity + signing pins)
  config/
    types.ts                 strict types + BUILTIN_DEFAULTS
    loader.ts                TOML parsing + project discovery
    merge.ts                 deterministic merge
    validate.ts              field-level validation
    naming.ts                project name + image resolution
    secrets-check.ts         secret-source presence checks
    records.ts               record merge helper
    index.ts                 loadConfig facade
  msb/
    subprocess.ts            Bun.spawn wrapper, which(), printOnly
    argv.ts                  deterministic argv builders (with stock mounts)
    lifecycle.ts             querySandboxState, planRunSequence, bootstrap planning
    print.ts                 shell-safe quoting
  bootstrap/
    discovery.ts             XDG-based personal bootstrap discovery and hashing
  setup/
    setup.ts                 Stock image build, save, load planner and execution
  install/
    symlink.ts               ~/.local/bin/mise-msb symlink installer
```
