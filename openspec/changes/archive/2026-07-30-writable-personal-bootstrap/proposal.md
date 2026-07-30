# writable-personal-bootstrap Proposal

## Why

The personal bootstrap directory (`~/.config/mise-msb/bootstrap/`) is mounted read-only in stock sandboxes, so `mise use -g <tool>` inside a sandbox fails with `mise ERROR failed write: /etc/mise-msb/personal/mise.toml — Read-only file system (os error 30)`. The personal global mise config is the natural target for global tool installs; making it writable lets sandbox work flow back to the host bootstrap and — because the bootstrap content hash changes — propagate to every other sandbox on its next invocation.

## What Changes

- The personal bootstrap directory mount changes from read-only to read-write (`options: "ro"` removed in `configurePersonalBootstrap`).
- Guest processes can then modify `mise.toml` (e.g. `mise use -g`) and add or edit sibling bootstrap files from inside the sandbox; changes land directly on the host.
- Documentation (`docs/security.md`, `docs/architecture.md`, `docs/usage.md`) is updated: the read-only mount is currently documented as a security property and becomes a documented, accepted guest-writable surface.
- **BREAKING** (behavioral): sandbox code can now modify host files under `~/.config/mise-msb/bootstrap/`. This is accepted by design — the personal bootstrap is trusted operator-owned content — but it is a real change to the host/guest boundary.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `personal-sandbox-bootstrap`: the discovery requirement currently mandates mounting the bootstrap directory **read-only**; it becomes **read-write**, and the capability gains the write-through semantics (guest edits persist on host, content-hash propagation to other sandboxes).

## Impact

- **Code**: `src/bootstrap/discovery.ts` (`configurePersonalBootstrap` — one-line change; optionally canonicalize the source path), `tests/bootstrap.test.ts` (read-only expectation flips).
- **Docs**: `docs/security.md` (explicitly documents the ro mount as a security property), `docs/architecture.md` (`(ro)` annotation), `docs/usage.md` (Personal Bootstrap section).
- **Behavior**: `mise use -g` and general editing of bootstrap content work inside sandboxes; changes propagate to other sandboxes via the existing content-hash/marker mechanism.
- **Verified by spike**: `mise use -g jq@1.8.1` and `usage@2.5.0` against an rw dir mount succeed and write through to the host file; guest-created sibling files land on the host. Note: msb dir mounts fail with `ENOTDIR` when the source path traverses a symlink (e.g. macOS `/tmp`); file mounts are unaffected.
