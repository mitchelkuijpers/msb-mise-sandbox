# Security

## Sandbox Commit Signing

`[signing]` is the **single accepted exception** to the rule that key
material is never readable by guest code. When enabled, a dedicated,
per-user, passphrase-less ed25519 private key is mounted read-only into
the sandbox so that guest `git commit` can produce forge-verifiable
signatures without any agent forwarding.

The key grants **commit-signing capability only, never authentication**,
by construction:

- **Location invariant** — the key must resolve (symlinks included) to a
  path under the wrapper-owned directory `~/.config/mise-msb/signing/`.
  No config layer — including a hostile committed `.sandbox.toml` — can
  point the feature at an authentication key such as `~/.ssh/id_ed25519`;
  validation fails closed before any `msb` invocation.
- **Guest placement outside `~/.ssh`** — the keypair is mounted at
  `/etc/mise-msb/signing/`, so no guest tool picks it up by convention
  for authentication.
- **Mount-only delivery** — key material travels via read-only
  `--mount-file` entries only, never `--copy`, `--env`, or argv, so it
  never enters the guest writable layer and cannot ride along in an
  `msb snapshot create/export`. The only `--copy` artifact is the
  generated gitconfig, which contains paths and identity values only.
- **Forge-registered as a signing key** — the public key is registered
  with the forge as an SSH *signing* key, which grants no SSH access.

The accepted residual risk: guest code can sign arbitrary commits as the
operator while the sandbox exists. This is bounded by the sandbox's
existing act-as-operator capability (TLS-injected forge tokens) and by
the revocation procedure below.

### Revocation runbook

1. **Remove the public key from the forge** (GitHub: Settings → SSH and
   GPG keys; GitLab: Preferences → SSH Keys). Signatures made with the
   key stop verifying as trusted immediately.
2. **Delete the host signing directory contents**:
   `rm -rf ~/.config/mise-msb/signing/` (and remove or regenerate with
   `mise-msb signing init` if you want signing again).

## Secret Configuration

The wrapper's secret configuration contains **references only** — never
values. Each entry in `[secrets.<name>]` declares:

- `from` — a host environment variable name (e.g. `GITLAB_TOKEN`).
- `hosts` — a list of allowed destination hosts.

The table key (e.g. `GITLAB_TOKEN`) is the **guest-facing** environment
variable name expected by tools inside the sandbox. The `from` field
identifies the **host-side** variable microsandbox reads when
substituting TLS-bound requests. When the two differ, the wrapper
generates a literal `$MSB_<SOURCE_ENV>` bridge so the guest tool can
read the value under the conventional guest variable name without ever
seeing the real value.

The wrapper:

1. **Verifies presence, never reads value.** Before generating any `msb`
   command, the wrapper checks that `from` is set in the host
   environment without copying its value into wrapper state.
2. **Emits source-based secret arguments.** Each secret produces one
   `--secret FROM@HOST` argument per allowed host. `msb` reads the value
   from its inherited host environment at sandbox start time.
3. **Bridges differing guest/source names with a literal placeholder.**
   When `secrets.<guest>.from != <guest>`, the wrapper emits
   `--env <GUEST>=$MSB_<FROM>`. The placeholder is a literal token; the
   wrapper never resolves it to a value and never places a real secret
   in argv.
4. **Treats the secret mapping as authoritative over `[env]`.** If an
   ordinary env entry shares the same key as a secret guest name, the
   secret bridge replaces it in argv. The real value never enters the
   command line via either path.
5. **Refuses inline values.** `msb` rejects `FROM=VALUE@HOST` syntax; the
   wrapper never attempts to construct it.

```toml
[secrets.OPENCODE_API_KEY]
from = "OPENCODE_API_KEY_PERSONAL"
hosts = ["opencode.ai"]
```

emits:

```
msb create ... \
  --env OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL \
  --secret OPENCODE_API_KEY_PERSONAL@opencode.ai ...
```

The microsandbox runtime substitutes the real value into TLS connections
to `opencode.ai` only. Connections to other hosts never see the secret.

The source-named placeholder (`$MSB_OPENCODE_API_KEY_PERSONAL`) is also
visible in the guest environment by virtue of the `--secret` argument.
Both the guest alias and the source placeholder hold the same literal
token until the microsandbox TLS proxy substitutes the real value at the
allowed destination.

## Personal Bootstrap Security

Personal bootstrap at `~/.config/mise-msb/bootstrap/mise.toml` runs as
trusted operator-owned code inside the microVM. The wrapper:

- **Mounts the bootstrap directory writable by design** at
  `/etc/mise-msb/personal`
- **Allows sandbox code to edit trusted bootstrap content** so `mise use -g`
  and sibling bootstrap files can be updated in place
- **Never reads file contents directly** — it only hashes paths and contents
  for change detection, so guest-originated edits still trigger the normal
  hash-based re-run path
- **Runs bootstrap from a neutral directory** outside the project workspace
- **Executes personal hooks separately from project hooks** — project
  configuration is not loaded during the personal stage

## Host Configuration Mounts

Host files and directories declared in personal `config.toml` mounts are
explicit — no path is auto-discovered or implicitly mounted:

```toml
[mounts.git-config]
kind = "file"
source = "~/.gitconfig"
target = "/root/.gitconfig"
options = "ro"
```

**Risks:**

- **Guest code can read all mounted host files.** API tokens, SSH keys,
  or OAuth credentials in mounted files are visible to sandbox processes.
- **Writable mounts can modify host state.** A compromised sandbox with
  writable mounts can modify the host filesystem within the mounted paths.
- **Broad mounts (e.g. `~/.config`) expose more files than needed.**
  Prefer narrowly scoped read-only mounts.

**Recommendations:**

- Use read-only (`options = "ro"`) for configuration files
- Prefer scoped paths (`~/.gitconfig`) over directory mounts (`~/.config`)
- Use microsandbox secrets for API keys instead of file mounts when
  possible
- Review mounted paths as part of `.sandbox.toml` code review

## Network Policy

The default egress policy is `allow` — sandboxes can reach any
destination unless the project explicitly opts into a deny-by-default
allowlist via `network.defaultEgress = "deny"`.

Each allow entry uses `<host>:<protocol>:<port>` syntax:

```toml
[network]
defaultEgress = "deny"
allow = [
  "github.com:tcp:443",
  "*.openai.com:tcp:443",
  "registry.npmjs.org:tcp:443",
]
```

The wrapper translates each rule to `--net-rule allow@<host>:<proto>:<port>`,
sorted for determinism.

Secret hosts automatically receive network access: when a secret allows
`api.example.com`, an equivalent `--net-rule allow@api.example.com:tcp:443`
is added unless the project already specifies a stricter rule.

## Published Ports

Published ports default to loopback (`127.0.0.1`) — exposing a port to
all interfaces requires explicit opt-in:

```toml
[ports.dns]
hostPort = 5353
guestPort = 53
protocol = "udp"
bind = "0.0.0.0"   # explicit
```

The wrapper emits `0.0.0.0:5353:53/udp` (or `127.0.0.1:8080:8080` when
bind is omitted).

## Committed Secret References

It is safe to commit `.sandbox.toml` files containing secret references.
The references name environment variables (e.g. `GITLAB_TOKEN`) and
allowed hosts (e.g. `gitlab.com`) but never values. Someone with access
to the project repo sees which environments are expected but not the
secrets themselves.

## Print Mode Safety

`--print` outputs `msb` argv arrays formatted for copy-paste. Secret
arguments contain only `FROM@HOST` (source variable name + allowed
host) and, when the guest and source names differ, the literal
`$MSB_<SOURCE_ENV>` placeholder bridge — never the secret value. There
is no `--no-redact` escape hatch. Personal bootstrap hashes and mount
sources are printable; file contents are never read or printed.

## Installation Safety

The wrapper's `install` command creates a symlink at
`~/.local/bin/mise-msb` pointing to the repository entry point. It:

- Does not edit `~/.zshrc`, `~/.bashrc`, `~/.profile`, or any other
  dotfile.
- Refuses to overwrite an existing symlink that points elsewhere unless
  `--force` is supplied.
- Refuses to recursively remove a directory at the destination, even
  with `--force`.
- Prints a non-fatal PATH hint when `~/.local/bin` is not on `$PATH`.

## Threat Model Notes

- **Root inside the microVM is not host root.** The agent has no more
  privileges than the user account that started `msb`.
- **Writable workspace mounts are dangerous.** The agent can modify or
  delete files in your project directory. Use Git for version control.
- **Network policy is not a security boundary against malicious agents.**
  An agent that can execute arbitrary code can still exfiltrate data
  through allowed hosts.
- **Personal bootstrap runs as trusted code.** The operator's bootstrap
  file can install and execute arbitrary programs in the microVM.
  Review bootstrap content as part of development environment setup.
- **The wrapper has zero third-party dependencies.** It uses Bun's built-in
  TOML parser and subprocess API. There is no JavaScript package supply
  chain to audit.
