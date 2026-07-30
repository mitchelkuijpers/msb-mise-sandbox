## Why

The CLI exposes runtime, connection, status, and teardown commands that merely wrap `msb`, expanding the wrapper beyond its configuration and sandbox-provisioning role. Narrowing the public surface leaves `msb` as the direct interface for those operations.

## What Changes

- **BREAKING** Remove `run`, `shell`, `exec`, `start`, `stop`, `remove`/`rm`, and `list`/`ls` from the CLI dispatcher and help output.
- Remove the removed commands' direct CLI modules and dispatcher imports while retaining the shared argv builders used by provisioning.
- Retain `setup`, `create`, `config`, `signing init`, and `install` as the supported setup-oriented commands.
- Update CLI tests and the wrapper CLI specification to assert the reduced command surface.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sandbox-wrapper-cli`: Reduce the supported command surface to setup and provisioning operations and remove runtime, connection, teardown, and status wrappers.

## Impact

- `src/commands/dispatch.ts` and the removed command entry modules.
- Direct command help/dispatch tests and the `sandbox-wrapper-cli` OpenSpec capability.
- Existing callers must invoke `msb` directly for sandbox runtime control, attachment, command execution, removal, and listing.
