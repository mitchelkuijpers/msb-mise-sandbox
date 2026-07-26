# Security Model

## MicroVM Isolation

The agent runs in a lightweight microVM, not a shared-kernel container.
This provides:

- **No kernel sharing** — the microVM runs its own Linux kernel, isolated
  from the host.
- **No host socket access** — no Podman, Docker, or any host sockets are
  mounted inside the microVM.
- **No privilege escalation** — root inside the microVM is mapped to the
  host user (via microsandbox's rootless mode). The agent has no more
  privileges than your user account.
- **No new privileges** — the `no-new-privileges` restriction prevents
  setuid/setgid escalation inside the microVM.

## Writable Workspace Mount

The project directory is bind-mounted at `/workspace` and is writable. The
agent can modify, create, or delete project files. This is necessary for
the agent to do its job, but it means a buggy or malicious agent can damage
your project. Mitigations:

- Use Git for version control (commit before running the agent).
- Use disposable copies of sensitive data.

## Secret Placeholder Mechanism

The most important security property: **real secret values never enter the
microVM.**

Secrets are configured in the project registry:

```json
{
  "secrets": [
    {
      "env": "GITLAB_TOKEN",
      "from": "env:GITLAB_TOKEN",
      "allow": "gitlab.com"
    }
  ]
}
```

How it works:

1. The CLI reads the real value from the host environment variable at
   sandbox-creation time.
2. Inside the microVM, the environment variable is set to a **placeholder
   string**: `$MSB_GITLAB_TOKEN`. The agent sees only this placeholder.
3. The real value is registered with the microsandbox `NetworkBuilder`,
   which enables TLS interception.
4. When the agent makes an outbound TLS connection to an allowed host
   (`gitlab.com`), the microsandbox runtime intercepts the TLS stream and
   substitutes the placeholder with the real value.
5. Connections to non-allowed hosts are blocked — the placeholder is never
   resolved there.

This means:

- An agent that inspects its environment variables sees only placeholders,
  not real tokens.
- An agent that tries to exfiltrate a placeholder to a non-allowed host
  sends a meaningless string.
- An agent that connects to an allowed host gets the real token
  transparently.

### Violation Policy

When a secret placeholder would be sent to a non-allowed host, the
microsandbox runtime can take one of three actions, configured via
`onSecretViolation`:

| Policy | Behavior |
|---|---|
| `block` (default) | Request is blocked, sandbox continues |
| `block-and-log` | Request is blocked and a violation is logged |
| `block-and-terminate` | Sandbox is terminated immediately |

### Secret Source Format

Secrets are resolved from the host environment. The `from` field must be in
the format `env:VARIABLE_NAME`. Only `env:` sources are supported currently.

## Network Policy

The default egress policy is **deny** — all outbound traffic is blocked
unless explicitly allowed. Allow rules are per-host, per-protocol, per-port:

- `gitlab.com:tcp:443`
- `*.openai.com:tcp:443`
- `registry.npmjs.org:tcp:443`

DNS resolution is automatically allowed when the default policy is `deny`.

## Nested Containers (Docker-in-sandbox)

When `docker.enabled` is true, the agent can run a real `dockerd` inside the
microVM and build/run nested containers. This stays inside the microVM
isolation boundary:

- **No host socket is mounted.** The daemon runs entirely inside the
  microVM with its own kernel — the "no host socket access" property above
  is unchanged. Host Docker/Podman sockets are never mounted; the nested
  engine is a separate, in-microVM `dockerd`.
- **Nested `--privileged` / `--network host` containers are still bounded
  by the microVM.** A nested container that requests `--privileged` gains
  privileges *inside the microVM*, not on the host. It is still confined by
  the microVM's kernel, its CPU/memory limits, and — critically — the
  deny-by-default egress policy. `--network host` inside the microVM uses
  the microVM's network namespace, not the host's.
- **Registry egress is explicit.** `docker pull` is subject to the same
  `network.allow` rules as any other outbound traffic; `docker.enabled`
  does **not** broaden egress.

Security layers:

1. **Isolation**: microVM, no kernel sharing, no socket mounts.
2. **Secrets at boundary**: real values never enter microVM.
3. **Network control**: deny-by-default egress with explicit allow rules.
4. **Resource limits**: CPU and memory limits prevent resource exhaustion.
5. **Credential isolation**: no host credential mounts, secrets via TLS
   boundary only.

## Project Scoping Is Enforced by GitLab Token Scope

The sandbox does not enforce project-level access restrictions. It holds
and forwards the GitLab token you provide. **Project scoping is the GitLab
token's job** — create tokens with the minimum required scope for each
project.

This means:

- If you use a token with `api` scope, the agent can access any project or
  group that token has access to.
- If you use a token with `read_repository` scope for one project, the
  agent is limited to that project.
- The sandbox merely stores and injects the token. It does not add or
  remove permissions.

## Credential Handling

The sandbox never mounts host credential directories (`~/.ssh`, `~/.aws`,
`~/.config`, etc.). Instead, secrets are injected via the TLS-boundary
placeholder mechanism described above.

For interactive authentication inside the sandbox:

```bash
agent-sandbox shell my-project
# Inside the microVM:
opencode auth
```

Credentials stored inside the microVM persist across stop/start cycles but
are lost when the sandbox is removed.

## Risk Summary

| Risk | Mitigation |
|---|---|
| Agent modifies project files | Use Git, commit before running |
| Agent exfiltrates data | Network policy limits egress |
| Agent steals API tokens | Tokens never enter microVM (placeholder mechanism) |
| Agent escalates privileges | MicroVM isolation, no-new-privileges |
| Agent consumes all resources | CPU and memory limits |
| Agent accesses other projects | GitLab token scope controls access |

## What the Sandbox Does NOT Do

- It does not sandbox network traffic after it leaves the microVM. An agent
  that gains code execution on an allowed host can exfiltrate data through
  that host.
- It does not prevent the agent from writing persistent backdoors into the
  workspace or the image layer.
- It does not enforce project boundaries — that is the token's
  responsibility.
- It does not provide a credential proxy or egress proxy beyond the
  TLS-intercepting placeholder mechanism.
