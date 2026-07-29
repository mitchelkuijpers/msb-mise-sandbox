# sandbox-commit-signing Specification (delta)

## ADDED Requirements

### Requirement: Dedicated signing key generation

The CLI SHALL provide `mise-msb signing init`, which creates
`~/.config/mise-msb/signing/` (using the configured XDG config home when
present) with mode 0700 and generates an unencrypted ed25519 keypair
named `id_ed25519_sandbox` (mode 0600) and `id_ed25519_sandbox.pub`
(mode 0644) inside it, using a fixed key comment identifying the key as
a mise-msb sandbox signing key. The command SHALL refuse to overwrite an
existing keypair unless `--force` is supplied. On success it SHALL print
the public key, exact forge-registration instructions (GitHub/GitLab SSH
signing key), and the corresponding `allowed_signers` line for the
operator to copy; it SHALL NOT write to project files.

#### Scenario: First init creates the keypair
- **WHEN** no signing key exists and the operator runs `mise-msb signing init`
- **THEN** the wrapper creates the signing directory and keypair with the documented names, permissions, and comment, and prints forge-registration instructions

#### Scenario: Init is idempotent
- **WHEN** a signing keypair already exists and the operator runs `mise-msb signing init` without `--force`
- **THEN** the command reports the existing key path and exits without modifying any file

#### Scenario: Force regenerates the keypair
- **WHEN** a signing keypair exists and the operator runs `mise-msb signing init --force`
- **THEN** the command replaces the keypair and prints a reminder that the old key must be removed from the forge

### Requirement: Signing key validation fails closed

When `[signing]` is enabled, the CLI SHALL validate the configured key
before any `msb` invocation, in both normal and `--print` modes, and
SHALL exit non-zero naming the problem and the remedy when any check
fails. The checks SHALL be: the key path, after `~` expansion and
symlink resolution, resolves under the wrapper-owned signing directory
(`~/.config/mise-msb/signing/`); the private key file has permissions
no broader than 0600; the key is of type ed25519; the key is
unencrypted (verifiable via `ssh-keygen -y -P ""`); and a sibling
`.pub` file exists whose content matches the public key derived from
the private key. Key material SHALL be inspected only via `ssh-keygen`
subprocesses and SHALL NOT be persisted, printed, or placed in argv or
environment output by the wrapper.

#### Scenario: Hostile project config cannot redirect signing at an auth key
- **WHEN** any config layer sets `signing.key` to a path outside the wrapper-owned signing directory (for example `~/.ssh/id_ed25519`)
- **THEN** create fails closed with an error naming the location invariant and executes no `msb` command

#### Scenario: Symlink escaping the signing directory is rejected
- **WHEN** `signing.key` points at a path inside the signing directory that is a symlink resolving to a file outside it
- **THEN** validation fails closed

#### Scenario: World-readable key is rejected
- **WHEN** the private key file has group- or other-readable permissions
- **THEN** validation fails with an error naming the permission problem and the `chmod` remedy

#### Scenario: Encrypted key is rejected
- **WHEN** `ssh-keygen -y -P ""` cannot derive a public key because the private key is passphrase-protected
- **THEN** validation fails with an error explaining that passphrase-less keys are required and naming `signing init` as the fix

#### Scenario: Mismatched public key is rejected
- **WHEN** the sibling `.pub` content differs from the public key derived from the private key
- **THEN** validation fails naming the mismatch

### Requirement: Signing key delivery is mount-only

When signing is enabled, sandbox creation SHALL deliver key material
exclusively via read-only `--mount-file` entries: the private key at
`/etc/mise-msb/signing/id_ed25519_sandbox` and the public key at
`/etc/mise-msb/signing/id_ed25519_sandbox.pub`, both with `ro` options.
Key material SHALL NOT be delivered via `--copy`, `--env`, or argv, and
guest targets SHALL NOT reside under the guest's `~/.ssh` directory, so
no guest tool can pick the key up by convention for authentication and
no key material enters the guest writable layer (and therefore no
sandbox snapshot).

#### Scenario: Create argv mounts the keypair read-only
- **WHEN** signing is enabled and create argv is generated
- **THEN** argv contains exactly one `--mount-file` entry per key file with fixed guest targets under `/etc/mise-msb/signing/` and `ro` options, and no `--copy` or `--env` argument carries key content

#### Scenario: Guest placement prevents authentication use
- **WHEN** the sandbox is created with signing enabled
- **THEN** the signing key files exist only under `/etc/mise-msb/signing/` and not under the guest user's `.ssh` directory

### Requirement: Guest git signing activation

When signing is enabled, sandbox creation SHALL generate a guest
gitconfig and deliver it via `--copy` to `/etc/mise-msb/gitconfig`, and
SHALL emit `--env GIT_CONFIG_GLOBAL=/etc/mise-msb/gitconfig`. The
generated file SHALL pin `gpg.format = ssh`,
`user.signingkey = /etc/mise-msb/signing/id_ed25519_sandbox.pub`, and
`commit.gpgsign = true`. When a host gitconfig mount is configured, the
generated file SHALL begin with an `[include]` of that mount's neutral
guest target (`/etc/mise-msb/host-gitconfig`) so host identity settings
flow through while the pinned signing entries override any inherited
signing configuration; when no host gitconfig mount is configured, the
include SHALL be omitted. The generated file SHALL contain no key
material.

#### Scenario: Generated gitconfig overrides inherited signing config
- **WHEN** the host gitconfig contains a conflicting `user.signingkey` or `gpg.format` and signing is enabled
- **THEN** the guest resolves `gpg.format=ssh`, the fixed guest `user.signingkey`, and `commit.gpgsign=true` because the generated entries follow the include

#### Scenario: Host identity flows through the include
- **WHEN** the host gitconfig sets `user.name` and `user.email` and its mount is configured
- **THEN** guest git resolves that identity alongside the pinned signing configuration

#### Scenario: No host gitconfig mount omits the include
- **WHEN** signing is enabled and no host gitconfig mount is configured
- **THEN** the generated gitconfig contains only the pinned signing entries and guest git uses the sandbox operator identity provided by other configuration

### Requirement: Signing transparency and revocation contract

Print mode SHALL render signing-related arguments as paths and fixed
guest targets only, consistent with existing print-mode safety. The
project security documentation SHALL describe the signing key as the
single accepted exception to the rule that key material is never
readable by guest code, SHALL state that the key grants commit-signing
capability only and never authentication, and SHALL provide a
revocation runbook: remove the public key from the forge, then delete
the host signing directory contents.

#### Scenario: Print mode shows signing paths only
- **WHEN** signing is enabled and a lifecycle command runs with `--print`
- **THEN** output shows the key and pubkey host paths and guest targets and contains no key material

#### Scenario: Revocation runbook exists
- **WHEN** an operator needs to retire a compromised sandbox signing key
- **THEN** `docs/security.md` provides the documented two-step revocation procedure
