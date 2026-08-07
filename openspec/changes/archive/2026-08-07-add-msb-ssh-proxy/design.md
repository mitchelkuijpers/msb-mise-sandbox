## Context

See `proposal.md` for motivation. Microsandbox serves external SSH entirely from the host process: `msb ssh serve <name> --stdio` connects one OpenSSH transport to a sandbox, while its per-sandbox host key is deleted when that sandbox is removed or replaced. OpenSSH configuration cannot remove a suffix from `%n`, so a wildcard `Host *.msb` entry cannot directly translate `agent-sandbox.msb` to the runtime name `agent-sandbox`.

The wrapper is currently stateless and intentionally delegates runtime lifecycle and connection operations to raw `msb`. Its installed executable is already on the host `PATH`, and the project has no runtime package dependencies. The SSH integration must preserve those boundaries and must never write status text into the protocol stream.

## Goals / Non-Goals

**Goals:**
- Make one OpenSSH block cover every current and future local microsandbox through a collision-resistant `.msb` alias namespace.
- Keep the proxy transport byte-transparent, shell-free after OpenSSH dispatch, and usable by any OpenSSH-based client.
- Make the security tradeoff explicit and limited to aliases matched by `Host *.msb`.
- Preserve the wrapper's stateless configuration model and raw-`msb` lifecycle ownership.

**Non-Goals:**
- Persist, rotate, inspect, or otherwise manage microsandbox SSH host keys.
- Edit `~/.ssh/config`, `known_hosts`, or authorized keys on the user's behalf.
- Replace `msb ssh`, provide a general interactive shell command, or wrap other runtime lifecycle operations.
- Configure remote TCP listeners; the integration uses only the local stdio bridge.
- Solve SSH authorization; users continue to authorize their public key through microsandbox.

## Decisions

### 1. Reserve `*.msb` as the OpenSSH alias namespace

Users connect to `<sandbox-name>.msb`. The reusable block matches only `Host *.msb` and invokes `mise-msb ssh-proxy %n`, where `%n` preserves the original alias supplied to OpenSSH. This follows microsandbox's documented `devbox.msb` convention and avoids applying relaxed host-key settings to ordinary SSH destinations.

Alternatives considered:
- `Host *` with `ProxyCommand msb ssh serve %h --stdio`: rejected because it intercepts and weakens every SSH destination.
- Rename actual sandboxes to include `.msb`: rejected because an editor transport convention should not alter runtime identity, volume names, or existing workflows.
- Generate one exact `Host` block per sandbox: rejected because it introduces mutable registry-like state, misses sandboxes created through raw `msb`, and leaves stale aliases behind.

### 2. Add a transport-only `ssh-proxy` command

`mise-msb ssh-proxy` accepts exactly one alias, requires a non-empty name followed by exactly the `.msb` suffix, removes that suffix, and launches the canonical argv `msb ssh serve <name> --stdio`. It does not load project configuration, discover a checkout, create or start a sandbox itself, or invoke a shell to construct the child command. Microsandbox remains responsible for resolving and starting the named sandbox.

The child inherits stdin, stdout, and stderr. The wrapper emits no normal output on this path and propagates launch failures, exit codes, and termination so OpenSSH observes the transport result. Validation failures occur before `msb` starts and are written only to stderr.

Alternative considered: embed shell parameter expansion in `ProxyCommand` to remove `.msb`. Rejected because quoting and token expansion would be platform-sensitive and would put user-controlled aliases into a shell program.

### 3. Print, but never install, the reusable SSH configuration

`mise-msb ssh-config` prints a deterministic, copyable block:

```sshconfig
Host *.msb
    User root
    ProxyCommand mise-msb ssh-proxy %n
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
```

It accepts no positional arguments and performs no filesystem mutation or subprocess call. The user remains in control of `~/.ssh/config`, including placement before any broad `Host *` defaults whose first-value-wins behavior could override these settings.

Alternative considered: append the block or an `Include` directive automatically. Rejected because editing security-sensitive user SSH configuration is surprising, difficult to merge safely, and unnecessary for a one-time setup.

### 4. Emit connection guidance only after successful creation

After `msb create` and every applicable stock bootstrap stage complete, `mise-msb create <name>` prints the ready alias `<name>.msb`, identifies `~/.ssh/config` as the destination, and points to `mise-msb ssh-config` for the reusable block. Failed creation, failed bootstrap, and `--print` mode do not claim that the alias is ready.

The create hint is informational and does not inspect whether the user already installed the block; doing so would require parsing OpenSSH's multi-file configuration semantics and would make output depend on mutable host state.

### 5. Accept scoped host-key verification disablement for the local stdio bridge

The generated block combines `StrictHostKeyChecking no` with `UserKnownHostsFile /dev/null`, preventing stale per-sandbox keys from blocking recreated aliases. This applies only to `*.msb`, whose `ProxyCommand` directly launches the local installed wrapper and `msb ssh serve --stdio`; it does not expose or connect to a TCP listener.

Documentation must state that these options disable SSH host-key authentication for the matching namespace and must never be copied into a global `Host *` block. Stable host identity remains a possible future microsandbox improvement rather than wrapper-managed key state.

## Risks / Trade-offs

- [Host authentication is disabled for `*.msb`] → Scope the settings to that namespace, use only the direct local stdio bridge, and document the boundary next to the snippet.
- [A user may already use `.msb` aliases for another purpose] → Make the configuration opt-in and never edit SSH files automatically.
- [Proxy stdout contamination breaks SSH negotiation] → Keep the proxy path free of banners and formatting, inherit protocol streams directly, and test with a byte-producing fake `msb` process.
- [OpenSSH invokes `ProxyCommand` through a shell] → Keep the config command fixed, pass only `%n` as one argument, validate the complete alias before delegation, and never construct a second shell command in the wrapper.
- [A broad earlier SSH setting may win before the included block] → Tell users to place the block near the top of `~/.ssh/config` and provide troubleshooting documentation using `ssh -G <name>.msb`.
- [Users bypassing `mise-msb create` do not see the hint] → The wildcard proxy still works for raw `msb` sandboxes; the hint is convenience, not registration.

## Migration Plan

1. Release the additive proxy and config commands with the post-create hint and documentation.
2. Existing sandbox names and SSH aliases continue to work unchanged; users opt in by adding the printed wildcard block.
3. To roll back, remove the `Host *.msb` block from `~/.ssh/config`. No sandbox, key, or wrapper state requires migration or cleanup.
