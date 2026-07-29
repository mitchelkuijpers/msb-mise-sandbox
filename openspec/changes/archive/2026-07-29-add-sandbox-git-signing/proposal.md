# Proposal: add-sandbox-git-signing

## Why

Commits created by agents inside microsandbox VMs are currently unsigned.
SSH agent forwarding into sandboxes is not supported by microsandbox
(verified empirically against msb 0.6.7: the host-side SSH server accepts
the `auth-agent-req@openssh.com` request but never provisions
`SSH_AUTH_SOCK` in the guest), and forwarding a host agent would violate
the wrapper's containment model anyway. The remaining safe path is a
dedicated, per-user, forge-registered, revocable signing key that is
deliberately readable inside the sandbox — granting commit-signing
capability only, never authentication.

## What Changes

- New `[signing]` configuration section: `enabled`, `key` (host path to
  a passphrase-less ed25519 private key), with fixed guest targets under
  `/etc/mise-msb/signing/`.
- Strict validation at create time, failing closed before any `msb`
  invocation: key must resolve under `~/.config/mise-msb/signing/`
  (location invariant — the feature can never point at an arbitrary host
  key such as `~/.ssh/id_ed25519`), perms ≤ 0600, matching `.pub` present,
  ed25519 type, unencrypted (passphrase-less by design).
- Signing delivery in generated `msb create` argv: read-only
  `--mount-file` entries for key and pubkey, a wrapper-generated guest
  gitconfig delivered via `--copy` that includes the (neutrally mounted)
  host gitconfig and then pins `gpg.format=ssh`, `user.signingkey`, and
  `commit.gpgsign=true`, plus `--env GIT_CONFIG_GLOBAL=/etc/mise-msb/gitconfig`.
- New `mise-msb signing init` helper command that generates the keypair
  in the correct location with correct permissions and prints
  forge-registration instructions (GitHub/GitLab SSH signing key).
- Documentation: `docs/security.md` gains an explicit "accepted
  exception" section for the signing key (dedicated, revocable,
  signing-only) plus a revocation runbook; `docs/usage.md` documents the
  `[signing]` schema.

## Capabilities

### New Capabilities

- `sandbox-commit-signing`: Generation, validation, delivery, and guest
  activation of a dedicated per-user SSH signing key for commits created
  inside sandboxes, including the `signing init` helper and the
  revocation contract.

### Modified Capabilities

- `layered-sandbox-config`: Schema and merge rules gain the `[signing]`
  table; strict validation gains signing-specific field checks and the
  key-location invariant.
- `sandbox-wrapper-cli`: `create` argv generation emits signing mounts,
  the generated gitconfig copy, and `GIT_CONFIG_GLOBAL` when signing is
  enabled; the command set gains `signing init`; create fails closed on
  signing validation errors.

## Impact

- **Code**: `src/config/types.ts` (new `SigningConfig` + partial),
  `src/config/validate.ts` (signing validation, key-location invariant),
  `src/config/merge.ts` (signing table merge), `src/msb/argv.ts`
  (mounts/copy/env emission), new `src/commands/signing.ts` (init
  helper), `src/commands/create.ts` (validation gate), dispatch wiring.
- **Docs**: `docs/security.md` (accepted-exception section, revocation
  runbook), `docs/usage.md` (`[signing]` schema reference).
- **Tests**: validation fixtures (hostile key paths, wrong perms,
  encrypted keys, mismatched pubkeys), argv snapshots with signing
  enabled/disabled, `signing init` idempotency.
- **Security posture**: introduces one deliberate, documented exception
  to the "no key material in guest" rule. Scope is limited to a key that
  cannot authenticate anywhere; revocation is forge-side key removal
  plus host file deletion.
- **No breaking changes**: signing is opt-in; configurations without
  `[signing]` behave exactly as before.
