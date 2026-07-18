## 1. Project Scaffold

- [ ] 1.1 Create `package.json` with `microsandbox@0.6.6` dependency, `type: "module"`, and bun/tsx run scripts
- [ ] 1.2 Create `tsconfig.json` with strict mode, ESM output, and node 22 lib targets
- [ ] 1.3 Create `src/` directory structure: `src/cli.ts`, `src/commands/`, `src/lib/`, `src/types.ts`
- [ ] 1.4 Add CLI framework (commander or clipanion) to `package.json` and install
- [ ] 1.5 Add `mise.toml` entries for bun and tsx (or rely on bun's native TS support) and verify `bun src/cli.ts --help` runs
- [ ] 1.6 Verify `import { Sandbox, Rule, Destination, NetworkPolicy } from "microsandbox"` resolves and types are picked up

## 2. OCI Image Adaptation

- [ ] 2.1 Edit `Containerfile`: remove `config/entrypoint.sh` reference, keep Ubuntu 24.04 + apt deps + mise install + `mise.toml` copy
- [ ] 2.2 Verify the image builds with `docker build -t agent-sandbox:latest Containerfile`
- [ ] 2.3 Load the image into microsandbox: `docker save agent-sandbox:latest | msb image load` and verify with `msb image list`
- [ ] 2.4 Boot a manual sandbox from the custom image and verify `mise ls` lists node, python, opencode, codex, ripgrep, fd

## 3. Config Layer

- [ ] 3.1 Define `ProjectConfig` TypeScript type in `src/types.ts` matching the project registry schema (gitlab, secrets, env, network, resources, mounts)
- [ ] 3.2 Implement `src/lib/config.ts`: load `~/.agent-sandbox/projects.json`, validate against schema, return typed `ProjectConfig` or throw with a clear error
- [ ] 3.3 Implement `src/lib/config.ts`: write/update the registry file (for `project add`/`project remove`), preserving existing entries
- [ ] 3.4 Add unit tests for config load/validate/update (Vitest) covering: valid config, malformed JSON, missing fields, defaults applied

## 4. Sandbox Runtime Library

- [ ] 4.1 Implement `src/lib/sandbox.ts`: `createSandbox(project, config)` — calls `Sandbox.builder(name)` with image, cpus, memory, mounts, env, secrets, network policy from the project config
- [ ] 4.2 Implement `startSandbox(name)`, `stopSandbox(name)`, `removeSandbox(name)`, `listSandboxes()` wrapping `msb` CLI calls via child_process
- [ ] 4.3 Implement `execInSandbox(name, cmd, args)` and `shellInSandbox(name)` using the SDK `exec`/`execStream` API with TTY support
- [ ] 4.4 Add integration test: create a sandbox from a stock image, exec `echo hello`, verify output, stop and remove

## 5. Secrets and Network Policy Builders

- [ ] 5.1 Implement `src/lib/secrets.ts`: convert project config `secrets[]` to NetworkBuilder secret calls — use `.network((n) => n.secret((s) => s.env(secretName).value(hostValue).allowHost(host)))` (NOT SandboxBuilder.secret, which is broken in v0.6.6). Read value from host env, validate presence.
- [ ] 5.2 Implement `src/lib/network.ts`: convert project config `network.allow[]` strings (e.g., `"gitlab.com:tcp:443"`) to `NetworkPolicy` with `Rule.allowEgress(Destination.domain(...))` + `Rule.allowDns()`. Enable TLS interception via `.tls((t) => t)` on the NetworkBuilder (required for secret substitution).
- [ ] 5.3 Implement the env-var bridge: for each secret, set `.env("<toolEnvVar>", "$MSB_<secretName>")` on the SandboxBuilder so tools that read env vars get the placeholder string (not the real value).
- [ ] 5.4 Add a secret-missing-host-env guard: if a referenced env var is not set on the host, print a clear error and exit non-zero before creating the sandbox.
- [ ] 5.5 Add integration test (based on spike round 7): create a sandbox with two secrets (GitLab + OpenAI pattern) using env-var bridge + NetworkBuilder secrets + TLS interception, verify placeholder substitution to allowed hosts via httpbin/headers echo, verify blocked host is unreachable, verify real values not in env.

## 6. CLI Commands — Lifecycle

- [ ] 6.1 Implement `src/commands/create.ts`: `agent-sandbox create <project>` — load config, call `createSandbox`, print status
- [ ] 6.2 Implement `src/commands/start.ts`, `stop.ts`, `restart.ts`, `remove.ts` wrapping the sandbox lib
- [ ] 6.3 Implement `src/commands/shell.ts` and `exec.ts` for interactive shell and single-command execution
- [ ] 6.4 Implement `src/commands/list.ts` wrapping `msb list` with formatted output
- [ ] 6.5 Wire all commands into `src/cli.ts` entry point and verify `bun src/cli.ts --help` lists them

## 7. CLI Commands — Agent Execution

- [ ] 7.1 Implement `src/commands/opencode.ts`: `agent-sandbox opencode <project>` — exec `opencode` interactively with TTY
- [ ] 7.2 Implement `src/commands/codex.ts`: `agent-sandbox codex <project>` — exec `codex` interactively with TTY
- [ ] 7.3 Validate the env-var bridge works with opencode/codex: confirm the tools read the placeholder from env (e.g., `GITLAB_TOKEN=$MSB_GITLAB_TOKEN_REAL`) and the proxy substitutes it in their outbound API calls. The spike verified the mechanism with wget; confirm it works with the actual agent HTTP clients.
- [ ] 7.4 Confirm Codex/ChatGPT OAuth endpoints: run `codex auth` once with broad network, observe which hosts it contacts, then lock down the network policy to those endpoints
- [ ] 7.5 Document the chosen placeholder integration pattern in `docs/usage.md`

## 8. CLI Commands — Project Registry

- [ ] 8.1 Implement `src/commands/project-add.ts`: interactive prompt for GitLab URL, token env var name, additional secrets; write to registry
- [ ] 8.2 Implement `src/commands/project-list.ts`: print all projects with name, GitLab URL, secret names (not values)
- [ ] 8.3 Implement `src/commands/project-remove.ts`: remove a project entry from the registry
- [ ] 8.4 Reject duplicate project names on add and non-existent names on remove with clear errors

## 9. Doctor and Smoke Tests

- [ ] 9.1 Implement `src/commands/doctor.ts`: check `msb` installed, `msb doctor` passes, custom image cached, `projects.json` valid
- [ ] 9.2 Rewrite `tests/smoke-test.sh` to test the TS CLI: scaffold → build image → project add → create → exec → opencode/codex launch → stop → remove
- [ ] 9.3 Run the smoke test end-to-end and fix any failures

## 10. Documentation and Cleanup

- [ ] 10.1 Update `README.md`: quick start for microsandbox, remove Podman/socket-proxy references, document secrets and network policy
- [ ] 10.2 Update `docs/architecture.md`: microVM model, secrets at TLS boundary, network policy, project registry
- [ ] 10.3 Update `docs/security.md`: secret placeholder mechanism, violation policy, project-scoping is GitLab's job
- [ ] 10.4 Update `docs/usage.md`: new CLI commands, project config schema, placeholder integration patterns, Codex OAuth flow
- [ ] 10.5 Remove obsolete files: `lib/proxy.py`, `config/sshd_config`, `config/entrypoint.sh`, `config/bashrc`, `scripts/install.sh` (if replaced by npm/bun install)
- [ ] 10.6 Remove obsolete env vars from docs and code: `AGENT_FORWARD_ENV`, `AGENT_NETWORK`, `AGENT_PROXY_URL`

## 11. Reconcile Superseded Change

- [x] 11.1 Removed `openspec/changes/add-compose-support/` — the socket proxy and Compose-sandbox specs were superseded by microsandbox's native network policy + secrets and are no longer needed (deleted via `git rm`, recoverable from git history)
- [ ] 11.2 Run `openspec status --change migrate-to-microsandbox` and verify all artifacts are complete
