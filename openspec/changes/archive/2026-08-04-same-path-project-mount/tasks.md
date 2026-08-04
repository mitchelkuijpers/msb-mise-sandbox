## 1. Config merge

- [x] 1.1 Thread optional `projectRoot` through `mergeConfigs` and compute it before merging in `loadConfig`
- [x] 1.2 Resolve mount `source = "."` to the project root at merge time in the overlay mounts loop
- [x] 1.3 Add the built-in `project` mount default (`source = "."`, empty target) to `BUILTIN_DEFAULTS` and copy it in `cloneDefaults`
- [x] 1.4 Post-merge: fill the `project` target from the resolved source and sync `workdirTarget`/`identity.workdir`, gated on no explicit `workdir` key in any layer

## 2. Lifecycle and stock image

- [x] 2.1 Pass `config.workdirTarget` to the project bootstrap stage in `planStockBootstrapStages`
- [x] 2.2 Change `mise-msb-bootstrap` project case to `cd "${2:-$PWD}"` and update usage text
- [x] 2.3 Remove `WORKDIR /workspace` from the stock Containerfile
- [x] 2.4 Bump `STOCK_IMAGE_GENERATION` to 4 so warm `setup` rebuilds

## 3. Tests

- [x] 3.1 Add merge tests: dot-source expansion, same-path default, explicit project target override, explicit workdir precedence, no-projectRoot guard
- [x] 3.2 Add argv test: default merged config emits `--mount-dir /host/proj:/host/proj:rw` and `--workdir /host/proj` with no `/workspace`
- [x] 3.3 Add lifecycle test: project bootstrap argv ends with the resolved workdir
- [x] 3.4 Update tests asserting the old defaults (named-table keys, Containerfile WORKDIR) and guard the bootstrap workdir argument index

## 4. Documentation

- [x] 4.1 Rewrite "Mounting Your Project" with the same-path default and escape hatches
- [x] 4.2 Update the `[mounts.<name>]` schema section: dot-source resolution and reserved `project` name
- [x] 4.3 Update Quick Start, print-mode example, and the stock-image migration section for generation 4

## 5. Verification

- [x] 5.1 Run `bun test` and `bunx tsc --noEmit` clean
- [x] 5.2 Verify `mise-msb create --print` and `mise-msb config` show the same-path mount and workdir
- [x] 5.3 Rebuild stock image, recreate a sandbox, verify guest `pwd` equals the host project path and the memories mount is rw in both directions
- [x] 5.4 Verify the project bootstrap stage runs `mise` in the resolved workdir inside the guest
