## Why

Recreating a microsandbox changes its per-sandbox SSH host key, so OpenSSH-based tools such as VS Code Remote-SSH reject the reused alias until the user removes the stale `known_hosts` entry. A one-time, narrowly scoped `.msb` SSH configuration can make every current and future local sandbox reachable without recurring manual cleanup.

## What Changes

- Add a transport-only `mise-msb ssh-proxy <alias>.msb` command that validates the alias, strips the `.msb` suffix, and delegates the SSH byte stream to `msb ssh serve <sandbox> --stdio` without shell interpolation.
- Add `mise-msb ssh-config`, which prints a reusable `Host *.msb` block for `~/.ssh/config` using the proxy command, `User root`, and host-key checking disabled only for the `.msb` namespace.
- Print a post-create Remote SSH hint naming `<sandbox>.msb`, where to place the one-time SSH configuration, and how to obtain it again.
- Document why `StrictHostKeyChecking no` and `UserKnownHostsFile /dev/null` are limited to the direct local `msb --stdio` bridge and must not be configured globally.
- Keep lifecycle ownership unchanged: runtime operations remain raw `msb` commands, and the wrapper does not maintain a sandbox registry or edit user SSH files.

## Capabilities

### New Capabilities
- `sandbox-remote-ssh`: Universal `.msb` OpenSSH aliases, byte-transparent proxy delegation, reusable SSH configuration output, and post-create connection guidance.

### Modified Capabilities
- `sandbox-wrapper-cli`: Extend the intentionally narrow wrapper command surface with the non-lifecycle `ssh-proxy` and `ssh-config` integration commands and the successful-create SSH hint.

## Impact

- Affected code: CLI dispatch and usage text, a new SSH proxy/config command module, successful create output, and subprocess execution/exit propagation.
- Affected tests: command dispatch, proxy validation and argv integrity, SSH config rendering, stream/exit behavior, and create output.
- Affected documentation: README and usage/security documentation for `.msb` aliases and the scoped host-key-checking tradeoff.
- Dependencies: no new runtime package dependency; the feature continues to require the installed `msb` CLI and the existing `mise-msb` launcher on `PATH`.
