## Why

The current Podman-based sandbox relies on a hand-rolled socket proxy (`lib/proxy.py`) and an `AGENT_FORWARD_ENV` allowlist that puts real secret values into the container environment — documented as "less secure, temporary." There is no per-project API restriction and no first-class secrets injection; `AGENT_PROXY_URL` is reserved in `docs/architecture.md` for a "future credential-injecting egress proxy" that was never built. microsandbox (v0.6.6, already installed via mise) provides microVM isolation, host-injected secrets where real values never enter the VM, and network policy enforced at the same TLS boundary — exactly filling the reserved gap. A spike verified all three core mechanisms work on this machine: secret placeholder substitution at the boundary, deny-by-default egress, and secret-scope violation blocking.

## What Changes

- **BREAKING**: Replace the Podman container runtime with microsandbox microVMs as the isolation boundary. `bin/agent-sandbox` (1419-line bash) is rewritten as a TypeScript CLI using the microsandbox SDK (builder API, runs via bun/tsx, no build step).
- **BREAKING**: Remove `lib/proxy.py` socket proxy — replaced by microsandbox network policy + secrets (stronger: microVM with separate kernel, not shared-kernel container).
- **BREAKING**: Remove `AGENT_FORWARD_ENV`, `AGENT_NETWORK`, `AGENT_PROXY_URL` environment variables. Secrets become host-injected (real values never enter VM); network policy moves into per-project config.
- **BREAKING**: Remove SSH server (`config/sshd_config`, key pair) — replaced by `msb exec` / `msb shell` host-guest command channel.
- Add a project registry (`~/.agent-sandbox/projects.json`) for per-project configuration: GitLab URL, secrets, network allow-rules, resource limits, mounts.
- Add host-injected secrets: GitLab token and OpenAI API key are passed as placeholders (`$MSB_<NAME>`), substituted with real values only at the TLS boundary for allowed hosts. Real values never enter the VM.
- Add deny-by-default network egress with per-project allow rules (e.g., `gitlab.com:443`, `api.openai.com:443`, `auth.openai.com:443`).
- Keep: `Containerfile` (as OCI image base, minor edits), `mise.toml` (tool versions), OpenSpec planning system, `.opencode`/`.codex`/`.pi` agent skills, `tests/smoke-test.sh` (rewritten for new CLI).
- Codex/ChatGPT OAuth subscription: interactive auth inside the VM, token persists in `/root` named volume (matches current Podman behavior; hardenable to host-side OAuth + Secret injection later).

## Capabilities

### New Capabilities

- `microsandbox-runtime`: microVM lifecycle management (create/start/stop/exec/shell), OCI image build and caching, resource limits (CPU/memory), tool provisioning via mise, and agent execution (opencode/codex) inside the sandbox.
- `sandbox-secrets`: host-injected secrets with placeholder substitution at the TLS boundary, allowed-host scoping, violation policy (block by default), and the placeholder integration pattern for agent tools.
- `sandbox-network`: deny-by-default egress network policy with per-project allow rules, DNS resolution handling, and TLS interception for secret substitution.
- `project-registry`: per-project configuration (GitLab URL, token references, secrets, network allow-rules, resources, mounts) stored in `~/.agent-sandbox/projects.json`, with project add/list/remove commands.

### Modified Capabilities

None — no canonical specs exist in `openspec/specs/` yet. The `add-compose-support` change's specs (`compose-proxy`, `compose-sandbox`) are superseded by this change and will be archived.

## Impact

- **Rewritten**: `bin/agent-sandbox` → TypeScript CLI (`src/cli.ts` + `src/commands/` + `src/lib/`). Subcommand surface preserved (build/create/start/stop/exec/shell/opencode/codex/list/doctor), backend changes from podman to msb SDK.
- **Removed**: `lib/proxy.py`, `config/sshd_config`, `config/entrypoint.sh`, `config/bashrc`, SSH key pair, `AGENT_FORWARD_ENV`/`AGENT_NETWORK`/`AGENT_PROXY_URL` env vars, `--cap-drop`/`--security-opt` flags.
- **Modified**: `Containerfile` (remove entrypoint, keep apt + mise), `mise.toml` (add bun/tsx for CLI), `tests/smoke-test.sh` (rewrite for TS CLI), `docs/architecture.md` + `docs/security.md` + `docs/usage.md` + `README.md` (update for microsandbox model).
- **New**: `package.json`, `tsconfig.json`, `src/` directory tree, `~/.agent-sandbox/projects.json` config schema.
- **Dependencies**: `microsandbox` (npm, pinned 0.6.6), `bun` or `tsx` (runtime), CLI framework (commander or clipanion). Removes Podman dependency for the sandbox itself (Podman/docker still needed to build the OCI image).
- **Superseded**: `openspec/changes/add-compose-support/` — the socket proxy and Compose-sandbox specs are obsolete once microsandbox provides network policy + secrets natively.
- **Risk**: microsandbox is beta (v0.6.6) with breaking changes expected; pin version and expect API drift across releases.
