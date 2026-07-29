# Design: add-sandbox-git-signing

## Context

Agents running in microsandbox VMs create commits that are currently
unsigned. Microsandbox does not support SSH agent forwarding (its
host-side SSH server accepts the forwarding request but never provisions
`SSH_AUTH_SOCK` in the guest; verified empirically on msb 0.6.7), and
the wrapper's threat model forbids exposing host credentials to guest
code anyway.

The wrapper already has the building blocks this design composes:

- **Layered config** (`src/config/`): strict-validated TOML merged across
  built-in defaults → personal `~/.config/mise-msb/config.toml` → project
  `.sandbox.toml` → CLI overrides.
- **Explicit mounts** (`--mount-file src:dst:ro`) and **`--copy` rootfs
  patching** emitted in `src/msb/argv.ts`.
- **Personal config trust model**: personal layer is operator-owned and
  trusted; project layer is committed and potentially hostile.

Decisions locked during exploration: the key is **passphrase-less**
(agent processes must sign non-interactively; git's SSH signing invokes
`ssh-keygen` directly, no agent involved), **one per-user key** (not
per-project or per-instance), and integration is a **first-class
`[signing]` section** with wrapper-enforced guardrails rather than a
docs-only recipe.

## Goals / Non-Goals

**Goals:**

- Commits created inside a sandbox are signed and verify as "Verified"
  on the forge, with zero per-commit interaction.
- The signing key can never be an authentication key by construction
  (location invariant + guest placement outside `~/.ssh`).
- Hostile or careless project-layer config cannot redirect the feature
  at arbitrary host key material.
- Guest git configuration deterministically overrides any signing config
  inherited from a mounted host `~/.gitconfig`.
- Validation fails closed before any `msb` invocation, with errors that
  name the problem and the fix.
- `--print` output never contains key material (paths only — consistent
  with existing print-mode safety).

**Non-Goals:**

- SSH agent forwarding into sandboxes (unsupported upstream; unwanted
  under the threat model).
- Passphrase-protected keys and guest-local ssh-agent flows (rejected
  variant; the wrapper refuses encrypted keys with a clear message).
- Per-project or per-sandbox-instance key granularity and forge API
  automation for key registration.
- GPG/X.509 signing formats; SSH signing only.
- Managing `allowedSignersFile` content for teammates/CI verification
  (documented as a manual repo-level step).

## Decisions

### D1: Dedicated key directory as a location invariant

**Decision:** The signing key MUST resolve (after `~` expansion and
symlink resolution) to a path under `~/.config/mise-msb/signing/`.
Any other path is a validation error.

**Rationale:** Once `[signing]` exists in the mergeable schema, a
committed `.sandbox.toml` can name a key path. A negative blocklist
(reject `~/.ssh`, keys referenced in `~/.ssh/config`, default key
names...) is unbounded and fragile. A single wrapper-owned directory
makes "is this my auth key?" answered by construction: nothing outside
that directory can ever be mounted as a signing key, regardless of
which config layer asked.

**Alternatives considered:** Blocklist of sensitive paths (unbounded,
fails open on novel key locations); comparing against authorized_keys
and `~/.ssh/config` entries (parses unstable formats, still heuristic).

### D2: Own the guest's global gitconfig via `GIT_CONFIG_GLOBAL` + include

**Decision:** When signing is enabled, the wrapper generates a guest
gitconfig, delivers it via `--copy` to `/etc/mise-msb/gitconfig`, and
emits `--env GIT_CONFIG_GLOBAL=/etc/mise-msb/gitconfig`. The generated
file's first directive is an `[include]` of the host gitconfig mounted
read-only at a neutral path (`/etc/mise-msb/host-gitconfig`); signing
entries follow the include so git's own semantics override it:

```ini
[include]
    path = /etc/mise-msb/host-gitconfig
[gpg]
    format = ssh
[user]
    signingkey = /etc/mise-msb/signing/id_ed25519_sandbox.pub
[commit]
    gpgsign = true
```

**Rationale:** Git precedence is system < global < repo-local < env.
A mounted host `~/.gitconfig` occupies the global slot; writing
`/etc/gitconfig` (system) loses to it. Composing `GIT_CONFIG_KEY_n`
env entries with user-supplied ones requires fragile index bookkeeping.
Owning the global slot via `GIT_CONFIG_GLOBAL` and delegating back to
the host file through `[include]` keeps host identity (`user.name`,
`user.email`, aliases) flowing while deterministically pinning signing
config. If no host gitconfig mount is configured, the include path is
omitted from the generated file.

**Alternatives considered:** `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n` env
entries (works, but composing with user env entries requires index
scanning and breaks silently on collisions); editing the mounted
gitconfig (impossible — mount is read-only, and mutating host state is
out of bounds); guest bootstrap `git config --global` writes (hidden
state in the writable layer; not visible in `--print`; diverges from
the wrapper's declarative style).

### D3: Fixed guest paths outside `~/.ssh`

**Decision:** Guest targets are fixed: key and pubkey at
`/etc/mise-msb/signing/id_ed25519_sandbox[.pub]`, generated gitconfig at
`/etc/mise-msb/gitconfig`. Not configurable.

**Rationale:** Placement outside `~/.ssh` means no guest tool can pick
the key up by convention for authentication — signing-only by
placement. Fixed paths keep `--print` output stable, tests simple, and
docs unambiguous. The host-side filename is likewise fixed by
`signing init` so the location invariant and the guest path line up
without configuration surface.

### D4: Validate by subprocess, never by reading key material

**Decision:** Validation shells out to `ssh-keygen`: `-y -P "" -f <key>`
proves the key is unencrypted and yields the derived public key for
comparison against the sibling `.pub`; `-l -f` confirms type ed25519.
The wrapper compares digests/strings in memory and never persists,
prints, or places key material in argv or env.

**Rationale:** Consistent with the wrapper's existing "verify presence,
never read value" secret philosophy and zero-dependency stance —
`ssh-keygen` is guaranteed present on any macOS/Linux host that runs
git over SSH. Parsing PEM/OpenSSH key formats in Bun would add exactly
the kind of hand-rolled crypto parsing the project avoids.

**Alternatives considered:** Parsing the private key format directly
(fragile, hand-rolled parsing of key material); skipping the encrypted-
key check (fails late and mysteriously at first commit).

### D5: `signing init` owns key genesis

**Decision:** `mise-msb signing init` creates
`~/.config/mise-msb/signing/`, generates
`id_ed25519_sandbox` + `.pub` (via `ssh-keygen -t ed25519 -N ""` with a
fixed comment `mise-msb-sandbox-signing`), enforces 0700 on the
directory and 0600/0644 on the files, is idempotent (refuses to
overwrite without `--force`), and prints exact forge-registration
instructions.

**Rationale:** The location invariant (D1) is easiest to satisfy when
the tool that creates the key also chooses its home. Manual keygen
invites wrong locations, wrong permissions, and reused auth keys —
precisely the failures validation then has to catch.

### D6: `[signing]` allowed in any layer, `key` constrained everywhere

**Decision:** Both `enabled` and `key` may appear in personal or
project layers; merge follows the standard scalar-replacement rule.
Safety comes entirely from D1 (the location invariant applies
regardless of layer), not from restricting which layer may speak.

**Rationale:** Restricting fields to the personal layer would require
layer-aware validation the merge phase currently doesn't have, and buys
nothing once paths are invariant-constrained. A project can therefore
opt into signing (`enabled = true`) while the operator's personal layer
supplies or confirms the key — a reasonable division.

## Risks / Trade-offs

- **[Guest code can sign arbitrary commits as the operator]** →
  Accepted and documented. The sandbox already holds act-as-operator
  capability on the forge via TLS-injected tokens; signing adds
  verified-signature fabrication only. Mitigation is blast-radius
  control: the key authenticates nowhere, is revocable forge-side, and
  security.md gains a revocation runbook (remove forge key → delete
  host files → done).
- **[Unsigned commits believed to be signed]** → D2 makes signing
  config deterministic in the guest; validation fails create entirely
  when the key is missing/invalid rather than degrading to unsigned.
- **[Key leaks via sandbox snapshot]** → Delivery is mount-only for key
  material (`--mount-file`, never `--copy`), so keys never enter the
  guest writable layer and cannot ride along in `msb snapshot
  create/export`. The generated gitconfig (non-secret) is the only
  `--copy` artifact.
- **[`ssh-keygen` absent or behaves differently on host]** → Validation
  treats subprocess failure as a validation error naming the binary;
  the wrapper already requires a git-capable host for practical use.
- **[Host gitconfig changes break the include]** → The include target
  is a wrapper-controlled neutral mount path; absence of the mount
  omits the include (D2), so a missing host gitconfig degrades to
  signing-only config rather than an error.
- **[Encrypted key passes visual review but breaks CI-like agent
  flows]** → D4 refuses encrypted keys at create time with a message
  naming `signing init` as the fix.

## Migration Plan

Purely additive and opt-in. No existing configuration changes meaning;
sandboxes without `[signing]` produce byte-identical argv to before.
Rollback is deleting the `[signing]` table (and optionally the key
directory); no state migration exists because the wrapper is stateless.

## Open Questions

- Should `signing init` also print/append the repo-level
  `.git_allowed_signers` line for commit verification by teammates, or
  stay scoped to key genesis? (Leaning: print the line, don't write
  into project files — the wrapper avoids mutating project state.)
- Should `--print` mode run full signing validation (including
  `ssh-keygen` subprocesses), or a paths-only lightweight check?
  Full validation is safer; lightweight keeps `--print` side-effect
  free. Default: full validation — subprocesses are read-only.
