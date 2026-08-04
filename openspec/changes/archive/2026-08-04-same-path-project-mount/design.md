# Design: Same-path project mount

## Context

Coding agents and other guest tools commonly key per-project state —
memories, caches, history, shared configs — off the absolute project path;
most agents work better when they know the real path of the project they
are operating on. Every sandbox previously mounted the project at a fixed
`/workspace`, so every project presented the same path: per-project identity
collapsed, tools could not tell projects apart, and their state landed on
the ephemeral guest rootfs.

The wrapper (Bun/TypeScript, `src/config/*` merge pipeline, `src/msb/*` lifecycle argv builders, `src/stock-image/*` image artifacts) decides the mount set, the workdir, and the bootstrap sequence. This change makes the mount set and workdir follow the host-absolute project path so the guest's identity matches the host's.

## Goals / Non-Goals

Goals:

- Mount the project directory in the guest at the same absolute path as on the host.
- Default the sandbox workdir (and shell cwd) to that path.
- Resolve `source = "."` mount sources to the project root at merge time, visible in `mise-msb config` and validation.
- Run the project bootstrap stage (`mise install`) in the resolved workdir.
- Keep the memories store out of the wrapper: a plain static mount in the user's global config is sufficient.

Non-goals:

- Any agent-runtime-specific wrapper code: per-project stores (e.g. an agent
  memories directory) are user configuration, not wrapper behavior.
- Changing how agents derive per-project identity or making that derivation
  platform-stable (guest Linux vs host macOS); that is verified
  end-to-end, not engineered.
- Support for `~` in mount sources (msb rejects it; configs must use absolute paths).

## Decisions

### D1: Expand `"."` and derive the workdir at merge time, not at argv build time

`mergeConfigs(partials, projectRoot?)` gains an optional `projectRoot`. The built-in `project` mount's `source = "."` resolves to it, the default target is filled from the resolved source, and the post-merge sync sets `workdirTarget`/`identity.workdir` from the effective target. Layered config consumers (`mise-msb config`, validation, print mode) all see absolute paths with no special-casing.

Alternatives considered: expansion in `mountArgv`/`buildCreateArgv` — rejected: `config` display and validation would show the unexpanded `"."`, and argv builders would need projectRoot threaded through separately.

### D2: Built-in `project` mount with `target = ""` filled post-merge

`BUILTIN_DEFAULTS.mounts.project = { kind: "dir", source: ".", target: "", options: "rw" }`. The empty target is the sentinel "derive from source", filled after all layers merge. The name `project` is deliberately new: existing personal configs with `[mounts.workspace]` merge by name and are untouched (they now mount the project at `/workspace` additionally — harmless duplicate, removable by the user).

The `project`-workdir sync runs once, post-merge, so a layer-supplied `[mounts.project]` (explicit target) and the built-in default are handled by the same code path. An explicit `target` on `[mounts.project]` is preserved and the workdir follows it; an explicit top-level `workdir` key in any layer wins over the sync entirely (tracked via a `workdirExplicit` flag set when the existing `workdir` handling fires).

### D3: Project bootstrap takes the workdir as its second argument

`mise-msb-bootstrap project <workdir>` — the helper's `$1` is the subcommand, so the workdir is `$2` (`cd "${2:-$PWD}"`). `msb exec` already runs with the sandbox's configured `--workdir`, so `$PWD` is correct when no argument is passed. The lifecycle stage argv becomes `[BOOTSTRAP_HELPER, "project", config.workdirTarget]`.

Note: the plan's original snippet used `"${1:-$PWD}"`; live testing showed `$1` is `"project"` — corrected to `$2` and covered by a test.

### D4: Image generation bump 3 → 4 instead of relying on `setup --force`

`setup` skips warm when the loaded image carries the expected `STOCK_GENERATION` label. The bootstrap-helper and `WORKDIR` changes live inside the image, so the generation label must change or warm setups would silently keep the stale image forever. `WORKDIR /workspace` is removed from the Containerfile (the wrapper always passes `--workdir`; the baked WORKDIR was only a fallback).

### D5: User-config mount for memories uses an absolute source

msb rejects `~` in mount sources (`mount-dir source "~/.omp/agent/memories": No such file or directory`). The `[mounts.omp-memories]` personal-config entry therefore uses `/Users/<user>/.omp/agent/memories`. This is user configuration, not wrapper behavior; the wrapper deliberately has no memories-specific code.

## Risks / Trade-offs

- [omp bank hashing is assumed platform-stable (guest Linux vs host macOS hash the same absolute string identically)] → Verified end-to-end by comparing the bank name in guest and host; if the hashes differ, sandbox banks remain persistent and isolated (host sharing lost) with no wrapper change possible.
- [Legacy `[mounts.workspace] target = "/workspace"` entries now produce a duplicate mount] → Harmless bind mount; documented in `docs/usage.md`; users can delete the entry.
- [Host-absolute paths in `workdirTarget`/`identity.workdir` leak host layout into config output] → Intended; `mise-msb config` displays them verbatim (it already displayed projectRoot).
- [A `project` mount with empty target could reach validation if `projectRoot` is absent] → `loadConfig` always passes `projectRoot`; the optional parameter exists only for unit tests.

## Migration Plan

1. Run `mise-msb setup` to build and load `mise-msb-base:v4` (generation bumped).
2. Stop, remove, and recreate existing stock sandboxes so they pick up the new image and mount set.
3. Optionally delete the legacy `[mounts.workspace]` entry from personal configs.
4. Rollback: revert the merge/lifecycle changes and the generation bump; `setup --force` reloads v3.

## Open Questions

- None blocking. The end-to-end shared-state check is pending a working
  personal bootstrap (a pre-existing 400 on the `oh-my-pi`/`tuicr` release
  lookups blocks installing the coding-agent runtime inside the guest).
