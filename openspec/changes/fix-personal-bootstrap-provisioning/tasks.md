## 1. Stock Runtime Provisioning

- [x] 1.1 Change the personal branch in `src/stock-image/mise-msb-bootstrap` to run `mise bootstrap --cd /tmp/mise-msb-personal-bootstrap --yes`, retaining the existing neutral directory, hash skip, failure propagation, and post-success marker write.
- [x] 1.2 Add `/root/.local/bin` to the `src/stock-image/Containerfile` `PATH` after `/mise/shims` and `/mise/data/bin` and before all system binary directories.
- [x] 1.3 Advance `STOCK_IMAGE_GENERATION` from 2 to 3 so setup builds and loads the corrected baked helper and environment.

## 2. Regression Tests

- [x] 2.1 Strengthen `tests/stock-image.test.ts` to assert the personal helper uses the exact full-bootstrap command while the project branch retains its locked and unlocked `mise install` behavior.
- [x] 2.2 Add a stock Containerfile assertion that `/root/.local/bin` is present in the required precedence order between mise-managed and system paths.
- [x] 2.3 Confirm setup and lifecycle tests resolve the new v3 stock tag without hard-coded v2 assumptions.

## 3. Documentation

- [x] 3.1 Update `docs/usage.md` to name stock image v3 and show valid `[bootstrap.packages]` table syntax in the personal bootstrap example.
- [x] 3.2 Document that full personal bootstrap includes its tools phase, while project tools still use the separate project `mise install` stage.
- [x] 3.3 Add migration guidance to run `mise-msb setup` and recreate existing stock sandboxes, noting that named mise and Docker volumes persist but writable-layer files do not.

## 4. Verification

- [x] 4.1 Run `bun test` and fix any regressions in stock setup, lifecycle planning, bootstrap, or documentation assertions.
- [x] 4.2 Build/load the v3 image and use a disposable stock sandbox to verify a declared apt bootstrap package is installed and an executable created in `/root/.local/bin` resolves by name.
- [x] 4.3 Run `openspec validate fix-personal-bootstrap-provisioning` and confirm all proposal, design, specification, and task artifacts pass validation.
