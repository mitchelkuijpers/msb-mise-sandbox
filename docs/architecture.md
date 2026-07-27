# Architecture

## Overview

`mise-msb` is a stateless Bun/TypeScript wrapper that translates layered
TOML configuration into inspectable `mise` and `msb` commands. The
wrapper itself does not implement sandbox lifecycle, secret injection,
or network policy — it delegates those to `mise` and `msb`, which the
runtime already provides.

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

## Build Pipeline

```
        ┌────────────────────────────────────┐
        │ Linux host                         │
        │   $ mise oci build --from <base>   │
        │       --tag <tag> --output <dir>   │
        └────────────────────────────────────┘
                          OR (macOS)
        ┌────────────────────────────────────┐
        │ macOS host                         │
        │   $ msb run <builder-image> \      │
        │       --mount-dir <proj>:/ws:ro \  │
        │       --mount-dir <out>:/out:rw \  │
        │       -- mise oci build ...        │
        └────────────────────────────────────┘
                          ↓
        ┌────────────────────────────────────┐
        │ tar -C <layout> -cf <archive> .    │
        └────────────────────────────────────┘
                          ↓
        ┌────────────────────────────────────┐
        │ msb image load --input <archive> \ │
        │     --tag <tag>                    │
        └────────────────────────────────────┘
```

The macOS path is necessary because `mise oci build` embeds host-native
binaries into the image. On Linux the build runs directly; on macOS an
ephemeral Linux microVM (provided by `msb`) executes the build with the
project mounted read-only and the output mounted read-write.

## Lifecycle

```
┌────────────────────────────────────┐
│ mise-msb create <name> --print     │  inspect generated msb create argv
└────────────────────────────────────┘
                  ↓
        (optional) execute
                  ↓
┌────────────────────────────────────┐
│ msb create <image> --name <name>   │
│   --cpus N --memory M              │
│   --workdir /workspace             │
│   --env KEY=value (sorted)         │
│   --label K=V (sorted)             │
│   --net-default allow|deny         │
│   --net-rule allow@<host:proto:port> (sorted)
│   --secret SRC@HOST (sorted)       │
│   --mount-{dir,file,disk,named}    │
│   --port BIND:HOST:GUEST[/udp]     │
└────────────────────────────────────┘
```

## Module Layout

```
src/
  mise-msb.ts               entry point
  commands/
    dispatch.ts             hand-rolled CLI parser
    _shared.ts              load + apply CLI overrides
    build.ts                build command
    create.ts               create command
    run.ts                  run command (multi-step)
    shell.ts                shell command
    exec.ts                 exec command
    start.ts / stop.ts /    thin lifecycle delegations
    remove.ts / list.ts
    config.ts               print merged config
    install.ts              symlink installer
    lifecycle.ts            internal helpers
  config/
    types.ts                strict types + BUILTIN_DEFAULTS
    loader.ts               TOML parsing + project discovery
    merge.ts                deterministic merge
    validate.ts             field-level validation
    naming.ts               project name + tag derivation
    secrets-check.ts        secret-source presence checks
    records.ts              record merge helper
    index.ts                loadConfig facade
  msb/
    subprocess.ts           Bun.spawn wrapper, which(), printOnly
    argv.ts                 deterministic argv builders
    lifecycle.ts            querySandboxState, planRunSequence
    print.ts                shell-safe quoting
  build/
    oci.ts                  mise oci build + msb image load
  install/
    symlink.ts              ~/.local/bin/mise-msb symlink installer
```
