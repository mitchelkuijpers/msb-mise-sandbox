## Context

The agent-sandbox project currently provides a local coding-agent sandbox using rootless Podman on macOS. An agent (OpenCode, Codex) runs as root inside a rootless container, with a hand-rolled socket proxy (`lib/proxy.py`) intercepting sibling-container creation, capability drops, `AGENT_NETWORK=none` for offline mode, and `AGENT_FORWARD_ENV` for env-var forwarding. `docs/architecture.md` explicitly reserves `AGENT_PROXY_URL` for a "future credential-injecting egress proxy" that was never built. The current design has two weak spots: no per-project API restriction, and `AGENT_FORWARD_ENV` puts real secret values into the container environment (documented as "less secure, temporary").

microsandbox (v0.6.6, Apache 2.0, already installed via mise) provides microVM-based isolation with three native mechanisms that map directly onto the gaps: host-injected Secrets (real values never enter the VM), deny-by-default network policy with per-host allow rules, and TLS-boundary substitution. A de-risking spike on this machine verified all three: a literal placeholder (`$MSB_TEST_TOKEN`) in an outbound header was substituted with the real value at the TLS boundary for an allowed host (`httpbin.org`), blocked for a non-allowed host, and the real value never appeared in the guest environment or filesystem.

The spike also discovered that the microsandbox secret placeholder is NOT an environment variable — it is a literal string the guest uses in code/config, which the host-side TLS proxy scans for and substitutes. This is a key integration constraint for agent tools that expect env vars.

## Goals / Non-Goals

**Goals:**
- Replace the Podman container + socket proxy with a microsandbox microVM as the isolation boundary.
- Give the agent a GitLab API key restricted to a single project, where the real token never enters the VM and can only reach `gitlab.com`.
- Inject OpenAI API key and opencode subscription config as secrets or env vars, scoped to their required hosts.
- Provide a TypeScript CLI (run via bun/tsx, no build step) wrapping the microsandbox SDK, preserving the existing subcommand surface.
- Add a project registry for per-project configuration (GitLab URL, secrets, network rules, resources, mounts).
- Keep the Codex/ChatGPT OAuth subscription working via interactive in-VM auth (no regression from current Podman behavior).

**Non-Goals:**
- Automated GitLab Project Access Token creation and rotation (deferred to a follow-up change; v1 uses a manually-provided token).
- Host-side OAuth flow with Secret injection for Codex (hardenable later; v1 uses in-VM auth).
- Cloud-backend microsandbox deployment (local-first only for v1).
- Multi-tenant or remote sandbox management.
- Removing Podman/docker entirely — still needed to build the OCI image.

## Decisions

### D1: microsandbox microVM over Podman container

**Choice**: microsandbox microVM (Hypervisor.framework on Apple Silicon).
**Why**: Separate kernel per sandbox (stronger isolation than shared-kernel containers), native Secrets (real values never in VM), native network policy at the TLS boundary, and the host-guest command channel replaces SSH. The spike verified all core mechanisms work on this machine.
**Alternatives considered**:
- Keep Podman + extend `lib/proxy.py` into a credential-injecting egress proxy: would require building and maintaining a TLS-intercepting proxy in Python, duplicating what microsandbox already does natively. Higher effort, weaker isolation (shared kernel).
- Firecracker + custom orchestration: lower-level, more work, no SDK.
- gVisor / Kata Containers: Linux-only, not viable on macOS.

### D2: TypeScript CLI over bash (and over Rust)

**Choice**: Rewrite `bin/agent-sandbox` as a TypeScript CLI using the microsandbox TS SDK, run via bun/tsx.
**Why**: The TS SDK provides typed builder APIs for `Secret` and `NetworkPolicy` (compile-time safety vs string flags). TypeScript enables the follow-up GitLab PAT automation (HTTP calls, typed responses, token store, rotation) that would be painful in bash. The project already uses node 22 via mise. bun/tsx runs TS directly with no build step.
**Alternatives considered**:
- Bash wrapping the `msb` CLI: fine for lifecycle, but string-based `--secret`/`--net-rule` flags lose type safety, and GitLab PAT automation in bash (curl + jq + state files) would be painful.
- Python CLI: viable, but the project's agent layer (OpenCode) is TS-centric, and the microsandbox TS SDK is first-class.
- **Rust SDK**: microsandbox is Rust, so the Rust SDK is the reference implementation and is more complete — notably it does NOT have the v0.6.6 `SandboxBuilder.secret()` substitution bug (the CLI `--secret` path, which is Rust, works correctly), and it supports runtime secret modification (`msb modify --secret`) which the TS SDK lacks. Rust would be the better choice for a production service running many long-lived sandboxes with frequent secret rotation. However, for this project — a local dev CLI that creates a sandbox per project on demand — the TS workaround (secrets on the NetworkBuilder, documented in D3) is stable, rotation via sandbox recreation is acceptable, and the GitLab PAT automation (the real value-add of the rewrite) is much smoother in TS (fetch + typed responses + JSON store) than in Rust (reqwest + serde + binary distribution). If the TS SDK regresses further in future versions, the CLI is small enough to port.

### D3: Env-var bridge to secret placeholders (spike-verified)

**Choice**: Set each tool's expected env var to the literal placeholder string (`.env("GITLAB_TOKEN", "$MSB_GITLAB_TOKEN_REAL")`), and register the secret on the **NetworkBuilder** (not the SandboxBuilder). Tools read env vars as normal; the TLS proxy substitutes the placeholder for the real value at the network boundary for allowed hosts.

**Why**: The spike (round 7) verified this exact pattern end-to-end:
- `.env("GITLAB_TOKEN", "$MSB_GITLAB_TOKEN_REAL")` — env var holds the placeholder string, not the real value
- `.network((n) => n.tls((t) => t).secret((s) => s.env("GITLAB_TOKEN_REAL").value(realToken).allowHost("gitlab.com")).policy(...))` — secret on NetworkBuilder + TLS interception enabled
- Tool reads `GITLAB_TOKEN` from env → gets `$MSB_GITLAB_TOKEN_REAL` → puts it in `Authorization: Bearer $MSB_GITLAB_TOKEN_REAL` → proxy substitutes → server receives `Bearer <real-token>`
- Real value never in env, never in filesystem. Multiple secrets (GitLab + OpenAI) work independently.

**Critical v0.6.6 TS SDK bug discovered**: The `SandboxBuilder.secret()` and `SandboxBuilder.secretEnv()` methods exist in the TypeScript types but do NOT wire up TLS interception and placeholder substitution — the placeholder passes through unsubstituted. Secrets MUST be added on the `NetworkBuilder` (`.network((n) => n.secret(...))` or `.network((n) => n.secretEnv(...))`), which correctly wires up TLS interception + substitution. The CLI `--secret` flag works because its Rust code path handles this correctly.

**Evidence this is a bug, not documented behavior** (verified via source code and issue tracker):
- The docs explicitly claim "Adding any secret automatically enables TLS interception" for both `SandboxBuilder.secret()` and `NetworkBuilder.secret()` — no distinction is documented ([TS Secrets docs](https://docs.microsandbox.dev/sdk/typescript/secrets)).
- The Rust SDK's `SandboxBuilder.secret()` DOES auto-enable TLS — confirmed by [issue #969](https://github.com/superradcompany/microsandbox/issues/969), where a Rust user reported it auto-enabling "too well" (causing `CERT_NOT_YET_VALID` on Linux).
- Root cause in source: the napi-rs bridge (`sdk/node-ts/native/sandbox_builder.rs`) calls `prev.secret_entry(entry)` — a low-level method that takes a pre-built `SecretEntry` without auto-enabling TLS — instead of routing through the Rust `SecretBuilder` closure path that handles auto-enable.
- No GitHub issue tracks this specific TS SDK behavior. The `net-secrets` example is a manual demo without substitution verification, so CI would not catch it.
- This is the single most important implementation detail. Pin 0.6.6; re-test `SandboxBuilder.secret()` on upgrade and switch to it if fixed.

**Working pattern (verified)**:
```typescript
Sandbox.builder("agent")
  .image("agent-sandbox:latest")
  .env("GITLAB_TOKEN", "$MSB_GITLAB_TOKEN_REAL")      // env var = placeholder
  .env("OPENAI_API_KEY", "$MSB_OPENAI_KEY_REAL")      // env var = placeholder
  .network((n) =>
    n
      .tls((t) => t)                                   // enable TLS interception
      .secret((s) => s.env("GITLAB_TOKEN_REAL").value(gitlabToken).allowHost("gitlab.com"))
      .secret((s) => s.env("OPENAI_KEY_REAL").value(openaiKey).allowHost("api.openai.com"))
      .policy({ defaultEgress: "deny", rules: [...] })
  )
  .create()
```

**Alternatives considered**:
- SandboxBuilder.secret(): exists in types but broken in v0.6.6 — placeholder not substituted. Use NetworkBuilder.secret() instead.
- `.injectHeaders(true)` / `.injectBasicAuth(true)`: tested in spike round 4 — do NOT auto-add auth headers. They control where substitution happens, not whether it's enabled. Not needed since the env-var bridge works.
- Write a wrapper that reads the placeholder from a file and exports the real value: defeats the security model.

### D4: In-VM OAuth for Codex/ChatGPT subscription

**Choice**: Run `codex auth` interactively inside the VM; token persists in the `/root` named volume.
**Why**: microsandbox Secrets are for static values, not OAuth tokens that rotate. In-VM auth matches the current Podman behavior (no regression) and is pragmatic for v1. Network policy still constrains where the token can be sent.
**Alternatives considered**:
- Host-side OAuth + inject access token as Secret + host-side refresh: more secure (token never in VM) but requires refresh orchestration. Deferred to a hardening follow-up.

### D5: Project registry as JSON config

**Choice**: `~/.agent-sandbox/projects.json` with a typed schema per project (GitLab URL, token ref, secrets, network allow-rules, resources, mounts).
**Why**: Enables per-project scoping and the future PAT automation (v2 will add `tokenRef: "pat:glpt-xxx"` created via GitLab API). JSON is simple, versionable, and readable. The TS CLI validates it with a typed schema.
**Alternatives considered**:
- Per-project `.env` files: less structured, no typed validation.
- A database (SQLite): overkill for a local CLI.

### D6: Keep Containerfile as OCI image base

**Choice**: Adapt the existing `Containerfile` (Ubuntu 24.04 + mise + tools) as the microsandbox OCI image. Remove the entrypoint (microsandbox boots the VM + `agentd`); keep apt deps and mise tool installs.
**Why**: Minimal change to the image layer. mise tool versions stay in `mise.toml`. The image is built with docker/podman and loaded via `msb image load` (local) or pushed to a registry.
**Alternatives considered**:
- Use a stock image + bootstrap script: slower on fresh sandboxes (installs tools every time).

### D7: Pin microsandbox 0.6.6

**Choice**: Pin `microsandbox@0.6.6` in `package.json`.
**Why**: Beta product with breaking changes expected (network policy grammar already redesigned twice). Pinning prevents surprise breakage. Upgrade deliberately.

## Risks / Trade-offs

- **[microsandbox beta maturity (v0.6.6)]** → Pin version in `package.json`. Expect API drift across releases. Test before upgrading. The network policy grammar changed in v0.4.0 and v0.5.3.
- **[Secret placeholder is not an env var]** → Validate `.injectHeaders()` / `.injectBasicAuth()` during implementation. If auto-inject works, agents don't need the token. If not, configure tools to use the literal placeholder string. This is the biggest integration unknown.
- **[Codex OAuth endpoints unconfirmed]** → `auth.openai.com` + `chatgpt.com` are best guesses. During implementation, run the OAuth flow once with broad network, observe which hosts it hits, then lock down the network policy.
- **[Image pull is slow on flaky network]** → Pre-cache images via `msb pull` or build locally and `msb image load`. The spike observed a 5-minute pull for `python:3.12-slim`.
- **[Secret modification at runtime not in TS SDK]** → Create-time only in TS SDK. For rotation, recreate the sandbox. CLI `msb modify --secret` works but the TS CLI uses the SDK.
- **[Project-scoping is GitLab's job]** → microsandbox ensures the token can't leave to other hosts. GitLab ensures the token can't access other projects. v1 uses a manually-provided token; v2 will automate Project Access Token creation with minimal scope.
- **[OAuth token in VM filesystem]** → Codex token lives in `/root` named volume. Network policy limits where it can be sent, but it's not protected by the Secret placeholder mechanism. Same exposure as current Podman setup (not a regression). Hardenable later.
- **[msb inspect hides secrets]** → Confirmed in spike: secrets don't appear in `msb inspect` output. This is a security feature, not a bug, but it makes debugging harder. Use `--on-secret-violation block-and-log` to get violation logs.

## Migration Plan

1. **Spike** (done): Verified microsandbox core mechanisms on this machine.
2. **v1 core**: Build the TS CLI scaffold (`src/cli.ts`, `src/lib/sandbox.ts`, `src/lib/config.ts`). Implement `create`/`start`/`stop`/`shell`/`list`/`doctor` using the MSB SDK. Get one project working end-to-end with a manually-provided GitLab token.
3. **v1 agents**: Implement `opencode` and `codex` commands. Validate the placeholder integration pattern (`.injectHeaders()` vs literal string). Confirm Codex OAuth endpoints and lock down network policy.
4. **v1 polish**: Implement `project add`/`project list`/`project remove`. Rewrite `tests/smoke-test.sh` for the TS CLI. Update `docs/` and `README.md`. Remove `lib/proxy.py`, `config/sshd_config`, `config/entrypoint.sh`, and obsolete env vars.
5. **Archive `add-compose-support`**: The socket proxy and Compose-sandbox specs are superseded by microsandbox's native network policy + secrets.

**Rollback**: The existing `bin/agent-sandbox` bash CLI and Podman setup remain in git history. If microsandbox integration fails, `git revert` the migration commits to restore the Podman-based setup. No data migration is needed (the project directory and GitLab tokens are external).

## Open Questions

- **Q1 (RESOLVED by spike round 7)**: How do agent tools that expect env-var-based API keys bridge to microsandbox's literal-placeholder secret mechanism? **Answer**: Set the env var to the placeholder string (`.env("GITLAB_TOKEN", "$MSB_GITLAB_TOKEN_REAL")`) and register the secret on the NetworkBuilder. Tools read the env var as normal; the TLS proxy substitutes the placeholder at the boundary. See decision D3 for the verified pattern. The critical v0.6.6 detail: secrets MUST be on the NetworkBuilder, not the SandboxBuilder (which is broken in this version).
- **Q2 (DEFERRED)**: Codex/ChatGPT OAuth endpoints. Deferred for now — Codex OAuth flow will be validated during implementation with broad network, then locked down. Not a blocker for the core migration.
