## 1. Stock Image Contract

- [x] 1.1 Add a repository-owned Ubuntu stock Containerfile with pinned mise, Docker CE, common installation prerequisites, and stable image-generation metadata.
- [x] 1.2 Add an idempotent `docker-up` helper that starts dockerd, waits for `docker info`, and prints useful daemon diagnostics on failure.
- [x] 1.3 Add an argv-driven `mise-msb-bootstrap` helper with separate personal and project operations, sandbox-local personal hash markers, neutral-directory personal bootstrap, project trust, and conditional locked installation.
- [x] 1.4 Add focused tests or shell fixtures for helper idempotency, lockfile selection, bootstrap marker behavior, and failure exit codes.

## 2. Runtime Configuration

- [x] 2.1 Replace build-oriented image config with `stock` and `custom` image modes, an explicit custom image reference, and a 10G Docker data size; add no mise-specific quota setting.
- [x] 2.2 Extend TOML parsing, deterministic merge, effective-config output, and strict validation for the new image and stock-runtime settings.
- [x] 2.3 Stop deriving the lifecycle image as `<project>:dev`; resolve the versioned stock tag in stock mode and require an explicit, already available image reference in custom mode.
- [x] 2.4 Add post-identity validation for stock-reserved `/mise` and `/var/lib/docker` targets while preserving generic mounts in custom image mode.
- [x] 2.5 Add config loader, merge, naming, validation, and effective-config tests for defaults, precedence, invalid values, mode selection, and reserved-target conflicts.

## 3. Local Stock Setup

- [x] 3.1 Add stock image constants and a setup planner for Docker preflight, native-platform build, image save, and canonical `msb image load` argv.
- [x] 3.2 Add loaded-image detection so setup skips the expected generation by default and `--force` rebuilds it.
- [x] 3.3 Implement setup execution with streamed output, first-failure propagation, temporary cleanup on success, and archive preservation on load failure.
- [x] 3.4 Add `setup`, `setup --force`, `setup --print`, and `setup --dry-run` dispatch and help output without changing the existing symlink `install` command.
- [x] 3.5 Add setup planner and command tests covering cold setup, warm no-op, force, missing Docker, unsupported platform, print mode, and failed-load archive retention.

## 4. Derived Persistent State

- [x] 4.1 Derive `<sandbox>-mise-v1` and `<sandbox>-docker-data` names from the resolved sandbox identity.
- [x] 4.2 Inject a directory-backed named `/mise` mount without a quota and a disk-backed named `/var/lib/docker` mount with the configured size in stock create argv.
- [x] 4.3 Configure stock mise data, cache, config, state, shims, and PATH locations under `/mise` without affecting custom image mode.
- [x] 4.4 Add argv tests for exact named-mount syntax, deterministic ordering, configured Docker size, absence of a mise quota, separate project identities, and custom-mode omission.

## 5. Personal Bootstrap Discovery

- [x] 5.1 Add XDG-aware discovery of optional `~/.config/mise-msb/bootstrap/mise.toml` and its containing bootstrap directory.
- [x] 5.2 Implement deterministic recursive hashing of personal bootstrap relative paths and contents, including tests for stable order, changed supporting files, missing directories, and filesystem errors.
- [x] 5.3 Add the read-only `/etc/mise-msb/personal` mount and `MISE_GLOBAL_CONFIG_FILE` environment only when personal bootstrap exists.
- [x] 5.4 Add personal bootstrap config and hash to invocation resolution without reading mounted host configuration contents or secret values.

## 6. Stock Lifecycle Bootstrap

- [x] 6.1 Extend lifecycle planning to represent Docker readiness, optional personal bootstrap, project bootstrap, and user exec as explicit ordered argv groups.
- [x] 6.2 Run stock bootstrap after create/start and before run/shell/exec user commands; stop at the first failed stage and propagate its exit code.
- [x] 6.3 Preflight the expected stock image before creation and report a copyable `mise-msb setup` instruction when it is missing.
- [x] 6.4 Keep custom image mode on the generic lifecycle path without invoking stock helpers, building the referenced image, or claiming Docker compatibility.
- [x] 6.5 Extend print mode to render the complete stock sequence, derived mounts, bootstrap hash, and final command without executing subprocesses.
- [x] 6.6 Add lifecycle tests for absent/running/stopped states, bootstrap ordering, optional personal stage, changed project tools, stage failure, command argument preservation, and custom-mode behavior.

## 7. State Preservation and Host Mount Safety

- [x] 7.1 Extend stock sandbox removal output to identify preserved mise and Docker volume names and print canonical `msb volume remove` commands without deleting either volume.
- [x] 7.2 Add non-invasive warnings for broad or writable sensitive host mounts declared in personal config while leaving explicit narrow mounts supported.
- [x] 7.3 Add tests proving no host credential path is auto-discovered, configured host mounts remain visible in config/print output, file contents are not read, and removal remains non-destructive.

## 8. Retire Mise OCI Builds

- [x] 8.1 Remove the `build` command, dispatch/help entries, and `[build]` config types, defaults, parsing, merging, validation, and documentation.
- [x] 8.2 Move reusable direct Docker build/save/load behavior into stock setup, then delete the mise OCI orchestrator, personal Containerfile discovery, print planner, Linux builder VM, registry/skopeo handoff, and builder image.
- [x] 8.3 Remove obsolete mise OCI, custom-base, and builder tests and fixtures; replace them with stock setup and custom-reference lifecycle coverage.
- [x] 8.4 Remove the mise OCI experiment and remaining runtime references to `MISE_EXPERIMENTAL`, `build.from`, `build.tag`, and `build.builderImage` without reverting unrelated worktree changes.
- [x] 8.5 Add migration tests proving `[build]` is rejected, stock mode never invokes `mise oci`, and custom mode uses but never builds its explicit image reference.

## 9. Documentation and Migration

- [x] 9.1 Update README and usage documentation to lead with `mise-msb setup` once, followed by stock `create`, `run`, `shell`, and `exec` without a project build.
- [x] 9.2 Document personal `bootstrap/mise.toml` with generic mise bootstrap examples for personal tools, packages, dotfiles, and idempotent hooks.
- [x] 9.3 Document narrowly scoped host-configuration mount examples, read-only versus writable credential trade-offs, and the risk that guest project code can read mounted credentials.
- [x] 9.4 Document stock/custom image modes, the default 10G Docker size, mise storage without a quota, persistent volume inspection/removal, lockfile behavior, offline limitations, and migration from `<project>:dev` defaults.
- [x] 9.5 Update architecture and security documentation to reflect stock-runtime ownership, trusted personal bootstrap, references-only secrets, and complete retirement of wrapper-managed mise OCI builds.

## 10. End-to-End Verification

- [x] 10.1 Add a stock setup smoke test that builds and loads the local image, verifies warm setup skips, and confirms the expected image metadata and helper binaries.
- [x] 10.2 Add a Docker smoke test covering create readiness, `docker run hello-world`, stop/start recovery, and image-cache survival across remove/recreate.
- [x] 10.3 Add a mise smoke test covering cold personal/project install, warm reuse, personal bootstrap content changes, project `mise.toml` changes, and locked/unlocked behavior.
- [x] 10.4 Add a two-project isolation test proving distinct mise and Docker volumes and a custom image test proving stock helpers and image builders are not invoked.
- [x] 10.5 Run the full Bun unit test suite and typecheck, then run OpenSpec validation for `add-personalized-agent-runtime` and resolve all failures.
