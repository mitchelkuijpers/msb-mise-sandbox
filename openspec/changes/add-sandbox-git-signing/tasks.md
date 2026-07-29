# Tasks: add-sandbox-git-signing

## 1. Configuration schema

- [ ] 1.1 Add `SigningConfig` (`enabled: boolean`, `key?: string`) and `PartialSigning` to `src/config/types.ts`; add `signing` to `SandboxConfig` (default `{ enabled: false }`) and `PartialConfig`
- [ ] 1.2 Merge the `signing` table in `src/config/merge.ts` using standard scalar replacement (higher-precedence layer wins per key)
- [ ] 1.3 Extend strict validation in `src/config/validate.ts`: reject unknown `[signing]` keys, non-boolean `enabled`, non-string/empty `key`; expand `~` in `key` after load; skip key-file checks when disabled (spec: layered-sandbox-config "Signing configuration section")
- [ ] 1.4 Unit tests: layering scenarios (personal key + project enable, project key override), unknown-key rejection, disabled-with-missing-key passes

## 2. Signing key validation

- [ ] 2.1 Create `src/signing/validate.ts` implementing fail-closed checks per spec: location invariant (resolved path under `~/.config/mise-msb/signing/`, honoring XDG config home, symlink resolution), perms ≤ 0600, ed25519 type, unencrypted via `ssh-keygen -y -P ""`, sibling `.pub` matches derived public key
- [ ] 2.2 Error messages name the failed check and the concrete remedy (`chmod`, `mise-msb signing init`, location invariant explanation)
- [ ] 2.3 Key material only ever passes through `ssh-keygen` subprocesses; never persisted, printed, or placed in argv/env by the wrapper
- [ ] 2.4 Unit tests with fixture keys in a temp dir: valid key passes; outside-path key, escaping symlink, world-readable key, encrypted key, mismatched/missing `.pub` each fail with the specified error

## 3. argv emission and guest gitconfig

- [ ] 3.1 Create `src/signing/gitconfig.ts`: generate the guest gitconfig (`[include]` of `/etc/mise-msb/host-gitconfig` when a host gitconfig mount is configured, then pinned `gpg.format=ssh`, `user.signingkey` pointing at the guest pubkey path, `commit.gpgsign=true`); no key material in the generated file
- [ ] 3.2 Write the generated gitconfig to a temp file at create time and emit `--copy <tmp>:/etc/mise-msb/gitconfig` in `src/msb/argv.ts`
- [ ] 3.3 Emit read-only `--mount-file` entries for key and pubkey at fixed guest targets `/etc/mise-msb/signing/id_ed25519_sandbox[.pub]` and `--env GIT_CONFIG_GLOBAL=/etc/mise-msb/gitconfig`, in deterministic argv positions
- [ ] 3.4 When personal config mounts `~/.gitconfig` for signing, mount it at the neutral target `/etc/mise-msb/host-gitconfig` (ro) instead of `/root/.gitconfig` so the include chain owns the global slot (D2)
- [ ] 3.5 argv snapshot tests: signing enabled (all four emission kinds present, deterministic ordering, no key material), signing disabled (byte-identical to pre-change output)

## 4. `signing init` command

- [ ] 4.1 Create `src/commands/signing.ts`: `signing init [--force]` per spec — create dir 0700, generate `id_ed25519_sandbox` (0600) / `.pub` (0644) via `ssh-keygen -t ed25519 -N "" -C "mise-msb-sandbox-signing"`, refuse overwrite without `--force`
- [ ] 4.2 Print the public key, forge-registration instructions (GitHub/GitLab SSH signing key), and the `allowed_signers` line; on `--force` regeneration, remind the operator to remove the old key from the forge; never write to project files
- [ ] 4.3 Wire `signing` into `src/commands/dispatch.ts` and the CLI help surface; update the command list per the modified sandbox-wrapper-cli requirement
- [ ] 4.4 Tests: first init creates correct files/perms/comment, re-init is a no-op, `--force` regenerates

## 5. Create-path integration

- [ ] 5.1 Gate `create` (and any command that may create the sandbox) on signing validation before the first `msb` invocation, in normal and `--print` modes; propagate non-zero exit with the validation error
- [ ] 5.2 End-to-end verification: `signing init` → enable `[signing]` in a scratch personal config → `mise-msb create --print` shows mounts/copy/env with paths only → real sandbox: `git commit` produces a signature verifiable with `git log --show-signature` against an allowed-signers file, and `SSH`-style auth never picks up the key (key absent from guest `~/.ssh`)

## 6. Documentation

- [ ] 6.1 `docs/usage.md`: document the `[signing]` schema, the fixed guest paths, the generated-gitconfig include mechanism, and `signing init`
- [ ] 6.2 `docs/security.md`: new "Sandbox commit signing" section — the accepted exception to guest-readable key material, why the key grants signing-only capability (location invariant, guest placement outside `~/.ssh`, mount-only delivery, snapshot safety), and the two-step revocation runbook (remove forge key → delete host signing directory contents)
- [ ] 6.3 Update `AGENTS.md`-adjacent docs if they enumerate CLI commands or config sections

## 7. Validation and cleanup

- [ ] 7.1 `bun test` green, including new fixtures and snapshots
- [ ] 7.2 `openspec validate --changes add-sandbox-git-signing` passes
- [ ] 7.3 Verify `--print` output for a signing-enabled config contains no key material (grep for key-content patterns in snapshot output)
