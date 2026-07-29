## Context

The stock lifecycle discovers `~/.config/mise-msb/bootstrap/mise.toml`, mounts its directory into the sandbox, and runs `mise-msb-bootstrap personal <hash>` before project provisioning. The helper checks a sandbox-local content-hash marker and, when provisioning is needed, currently executes `mise install` from `/tmp/mise-msb-personal-bootstrap`. That command installs `[tools]` but does not process mise's bootstrap packages, repositories, dotfiles, hooks, user settings, or optional `bootstrap` task.

The helper and base environment are baked into the versioned stock image. Its current `PATH` starts with the persistent mise shims and data bin directories, then proceeds directly to system directories; `/root/.local/bin` is absent. Existing stock sandboxes continue using the image from which they were created, while their mise and Docker state live on persistent named volumes.

## Goals / Non-Goals

**Goals:**

- Make the personal stage satisfy the existing full-bootstrap contract without duplicating mise's orchestration logic.
- Preserve project isolation by running personal provisioning from the existing neutral directory.
- Preserve the content-hash skip behavior and update the marker only after successful provisioning.
- Make user-local executables available while retaining mise-managed tool precedence.
- Ensure setup detects that a new stock image must be built and loaded.

**Non-Goals:**

- Changing project bootstrap from `mise install` or altering its lockfile behavior.
- Automatically replacing running or stopped sandboxes when a new stock generation is loaded.
- Changing the personal bootstrap trust model, writable mount, or hash algorithm.
- Adding `/root/.local` as another persistent named volume.
- Passing `--update` on every personal bootstrap invocation or upgrading already-satisfied package declarations.

## Decisions

### D1: Delegate full personal provisioning to `mise bootstrap`

The personal branch of `mise-msb-bootstrap` will run:

```bash
mise bootstrap --cd /tmp/mise-msb-personal-bootstrap --yes
```

`mise bootstrap` processes the declarative bootstrap phases and then runs its own tools phase, which is equivalent to `mise install` for `[tools]`. A second personal `mise install` would be redundant. The existing `MISE_GLOBAL_CONFIG_FILE` points mise at the mounted operator config, and `--cd` keeps project configuration and project hooks out of the trusted personal stage. `--yes` prevents provisioning from blocking on confirmation in a non-interactive lifecycle command.

Alternatives considered:

- Invoke `mise bootstrap packages apply` followed by `mise install`: this would fix only packages and continue omitting repositories, dotfiles, hooks, and future bootstrap phases.
- Reimplement each phase in the wrapper: this would duplicate mise behavior and drift as mise adds capabilities.
- Run bootstrap from `/workspace`: this would merge project configuration into the trusted personal stage and violate the existing isolation requirement.

### D2: Retain the existing hash marker transaction boundary

The helper remains guarded by `set -euo pipefail` and writes the marker only after `mise bootstrap` exits successfully. Failed package, hook, dotfile, or tool provisioning therefore leaves the old marker in place and retries on the next lifecycle invocation. Unchanged successful bootstrap content remains skipped on warm starts.

### D3: Add `/root/.local/bin` after mise-managed paths

The stock image `PATH` will be ordered as:

```text
/mise/shims:/mise/data/bin:/root/.local/bin:<system paths>
```

This makes binaries installed by user-scoped package commands and bootstrap hooks directly executable while ensuring mise shims and mise-managed binaries continue to win name collisions. Defining this in the Containerfile applies consistently to bootstrap helpers, direct `msb exec`, and interactive non-login shells without editing shell startup files.

### D4: Advance the stock image generation to v3

Both corrections affect baked image content, so the stock generation changes from 2 to 3. `mise-msb setup` will see the new expected tag as absent and build/load it without requiring `--force`. Existing sandboxes are not silently replaced because that would destroy writable-layer state and exceed setup's current contract.

### D5: Verify source contracts and runtime behavior

Static stock-image tests will assert the full personal bootstrap command, retain assertions for the distinct project `mise install` paths, and verify `/root/.local/bin` placement in `PATH`. The full Bun suite will cover setup/tag planning and lifecycle command generation. A stock sandbox smoke test will verify an apt bootstrap package is installed and a test executable under `/root/.local/bin` resolves by name.

## Risks / Trade-offs

- [Full bootstrap executes more trusted directives than the current buggy helper] -> This is the intended existing contract; keep execution isolated from `/workspace`, preserve the documented trusted-operator boundary, and propagate failures.
- [A non-idempotent `bootstrap` task can produce repeated side effects after config changes] -> Mise explicitly defines this task as repeatable; document and test only wrapper-level hash gating rather than suppressing valid bootstrap phases.
- [Existing v2 sandboxes retain the old helper and PATH] -> Document setup plus remove/recreate steps; named mise and Docker volumes remain preserved by the wrapper.
- [User-local binaries can shadow system binaries] -> Keep `/root/.local/bin` after mise-managed paths but before system paths, matching normal user-local PATH conventions and making the precedence explicit in the spec.
- [Recreation drops unpersisted writable-layer files] -> Call this out in migration guidance; do not automate replacement.

## Migration Plan

1. Release the helper, PATH, tests, documentation, and generation bump together.
2. Run `mise-msb setup` to build and load `mise-msb-base:v3`.
3. Stop and remove each existing stock sandbox, then recreate it through the next lifecycle command. The existing mise and Docker named volumes are retained.
4. Verify personal bootstrap package installation and `/root/.local/bin` command resolution in the recreated sandbox.

Rollback uses the previous wrapper version and v2 image, followed by the same explicit sandbox recreation. Persistent named-volume formats are unchanged and require no data migration.

## Open Questions

None.
