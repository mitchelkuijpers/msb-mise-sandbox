# writable-personal-bootstrap Tasks

## 1. Core change

- [ ] 1.1 In `src/bootstrap/discovery.ts` `configurePersonalBootstrap`, remove `options: "ro"` from the personal bootstrap mount registration (design D1).
- [ ] 1.2 Canonicalize the mount source with `realpathSync(personal.dir)` before registering the mount, so symlinked config-home paths mount successfully (design D2; covers the msb `ENOTDIR` dir-mount failure on symlinked sources).

## 2. Tests

- [ ] 2.1 Update `tests/bootstrap.test.ts` ("adds the read-only mount and global mise config in stock mode") to expect a writable dir mount (no `options`) at `/etc/mise-msb/personal` with `MISE_GLOBAL_CONFIG_FILE` still set.
- [ ] 2.2 Add a test that a symlinked path to the bootstrap dir is canonicalized in the registered mount source.
- [ ] 2.3 Run `bun test` (full suite) and confirm no other test depends on the ro option.

## 3. Documentation

- [ ] 3.1 `docs/security.md`: rewrite the "Mounts the bootstrap directory read-only" bullet and surrounding personal-bootstrap section to state the directory is guest-writable by design, that sandbox code can modify trusted bootstrap content, and that content-hash change detection applies to guest-originated edits.
- [ ] 3.2 `docs/architecture.md`: change the `(ro)` annotation on the personal bootstrap mount line to `(rw)`.
- [ ] 3.3 `docs/usage.md` Personal Bootstrap section: document that the mount is writable, that `mise use -g` works in-sandbox and writes through to the host, and that changes propagate to other sandboxes on their next invocation via the content hash.

## 4. Verification

- [ ] 4.1 Manual smoke test: create a stock sandbox, run `mise use -g <tool>`, confirm the host `~/.config/mise-msb/bootstrap/mise.toml` is updated; create a sibling file in the guest mount and confirm it lands on the host.
- [ ] 4.2 Cross-sandbox propagation smoke test: in a second sandbox (or the same one after the edit), run any `mise-msb exec` and confirm personal bootstrap re-runs and the new tool is present.
