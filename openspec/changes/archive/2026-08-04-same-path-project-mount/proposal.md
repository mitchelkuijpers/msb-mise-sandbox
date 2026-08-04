## Why

Every sandbox mounted the host project at a fixed guest path `/workspace`, so
guest tools that key per-project state (memories, caches, history, shared
configs) off the absolute project path saw the same identity for every
project and wrote their state to the ephemeral guest rootfs. The fix mounts
the project at its host-absolute path, so sandbox and host share one
persistent, per-project state store and coding agents see the real project
path they operate on.

## What Changes

- Add a built-in `project` mount default (`source = "."`, `target` = resolved source, `options = "rw"`) that mounts the project directory into the guest at the same absolute path as on the host.
- Resolve mount `source = "."` to the project root at merge time so merged configs and `mise-msb config` show absolute paths.
- Derive the sandbox workdir from the effective `project` mount target; an explicit `workdir` key in any layer wins, and an explicit `[mounts.project] target` overrides the same-path default and moves the workdir with it.
- Pass the resolved workdir to the project bootstrap stage (`mise-msb-bootstrap project <workdir>`); the helper now defaults to the current directory instead of hardcoded `/workspace`.
- Remove `WORKDIR /workspace` from the stock image and bump the image generation to 4 so warm `setup` rebuilds.
- Update `docs/usage.md`: same-path default, escape hatches, `source = "."` semantics, reserved `project` name, updated print-mode examples.

## Capabilities

### New Capabilities
<!-- None: the behavior is distributed across three existing capabilities. -->

### Modified Capabilities
- `layered-sandbox-config`: Merge-time `"."` source resolution and the built-in same-path `project` mount with its workdir derivation and override precedence.
- `stock-sandbox-image`: The image no longer bakes a `WORKDIR`; the bundled project-bootstrap helper takes the resolved workdir as its second argument (defaulting to the current directory).
- `sandbox-wrapper-cli`: Stock create argv emits the same-path `--mount-dir` and `--workdir` by default; the project bootstrap stage passes the resolved workdir.

## Impact

- `src/config/merge.ts`, `src/config/types.ts`, `src/config/index.ts`: merge-time expansion and built-in mount default.
- `src/msb/lifecycle.ts`: project bootstrap stage argv now ends with `config.workdirTarget`.
- `src/stock-image/mise-msb-bootstrap`, `src/stock-image/Containerfile`, `src/stock-image/constants.ts`: helper workdir argument, no baked WORKDIR, generation 4.
- Existing personal configs with `[mounts.workspace] target = "/workspace"` keep working unchanged; the entry now additionally mounts the project at `/workspace` (harmless duplicate bind mount) and can be deleted.
- The `[mounts.omp-memories]` personal-config mount (host `~/.omp/agent/memories` → guest `/root/.omp/agent/memories`) is user configuration, not wrapper behavior; msb does not expand `~` in mount sources, so it must use an absolute path.
