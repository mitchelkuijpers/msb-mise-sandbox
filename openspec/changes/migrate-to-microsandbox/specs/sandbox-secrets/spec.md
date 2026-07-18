## ADDED Requirements

### Requirement: Host-injected secrets with placeholder substitution

The CLI SHALL inject secrets as host-injected values using the microsandbox `Secret` builder on the **NetworkBuilder** (not the SandboxBuilder, which is broken in v0.6.6). The real secret value SHALL never enter the microVM. The guest SHALL receive the literal placeholder string (`$MSB_<SECRET_NAME>`) via an env var bridge (`.env("<TOOL_ENV_VAR>", "$MSB_<SECRET_NAME>")`), which the host-side TLS proxy substitutes with the real value only when traffic reaches an allowed host.

#### Scenario: Real value never in guest environment

- **WHEN** a sandbox is created with a secret `GITLAB_TOKEN_REAL` and an env var bridge `.env("GITLAB_TOKEN", "$MSB_GITLAB_TOKEN_REAL")` and the user runs `env` inside the sandbox
- **THEN** the output shows `GITLAB_TOKEN=$MSB_GITLAB_TOKEN_REAL` (the placeholder string); the real token value is not present anywhere in the environment

#### Scenario: Placeholder substituted at TLS boundary for allowed host

- **WHEN** the guest sends an HTTP request to an allowed host with `Authorization: Bearer $MSB_GITLAB_TOKEN_REAL` (the placeholder read from the env var)
- **THEN** the host-side TLS proxy substitutes the placeholder with the real value before the request leaves the network boundary, and the destination receives `Authorization: Bearer <real-token>`

#### Scenario: Placeholder not substituted for non-allowed host

- **WHEN** the guest sends an HTTP request containing the literal placeholder to a host that is not in the secret's allowed-host list
- **THEN** the request is blocked (default violation policy) and the placeholder is not substituted

### Requirement: Secrets must be registered on the NetworkBuilder

In v0.6.6, secrets registered via `SandboxBuilder.secret()` or `SandboxBuilder.secretEnv()` do not wire up TLS interception and placeholder substitution — the placeholder passes through unsubstituted. This is a TS SDK bug (the docs claim both paths auto-enable TLS equally; the Rust SDK's `SandboxBuilder.secret()` does auto-enable, confirmed by issue #969; the napi-rs bridge calls a low-level `secret_entry()` method that bypasses the auto-enable logic). The CLI SHALL register all secrets on the `NetworkBuilder` (`.network((n) => n.secret(...))` or `.network((n) => n.secretEnv(...))`) alongside the `.tls()` configuration. This is the single most important implementation detail and must be validated in the integration tests. Pin 0.6.6; re-test `SandboxBuilder.secret()` on upgrade and switch to it if fixed.

#### Scenario: Secret on NetworkBuilder substitutes correctly

- **WHEN** a secret is registered via `.network((n) => n.tls((t) => t).secret((s) => s.env("TOKEN").value(real).allowHost("host")))` and the guest sends the placeholder to the allowed host
- **THEN** the proxy substitutes the real value and the destination receives it

#### Scenario: Secret on SandboxBuilder does NOT substitute (v0.6.6 bug)

- **WHEN** a secret is registered via `.secret((s) => s.env("TOKEN").value(real).allowHost("host"))` on the SandboxBuilder and the guest sends the placeholder to the allowed host
- **THEN** the placeholder passes through unsubstituted (the destination receives the literal `$MSB_TOKEN` string). The CLI MUST NOT use this pattern.

### Requirement: Allowed-host scoping

Each secret SHALL be scoped to one or more allowed hosts. The secret value SHALL only be substituted for traffic destined to those hosts (verified by DNS pin + TLS SNI match).

#### Scenario: Secret scoped to a single host

- **WHEN** a secret is configured with `allowHost("gitlab.com")` and the guest sends a request to `gitlab.com` containing the placeholder
- **THEN** the proxy substitutes the real value and the request proceeds

#### Scenario: Secret blocked for a different host

- **WHEN** a secret is configured with `allowHost("gitlab.com")` and the guest sends a request to `evil.com` containing the placeholder
- **THEN** the proxy blocks the request (violation policy) and the real value is not sent

### Requirement: Secret violation policy

The CLI SHALL configure the default secret violation policy as `block` — requests that would send a placeholder to a non-allowed host are blocked. The policy SHALL be configurable per project to `block-and-log` or `block-and-terminate` for debugging.

#### Scenario: Default block policy

- **WHEN** a secret violation occurs (placeholder sent to non-allowed host) and no explicit policy is set
- **THEN** the request is blocked and the sandbox continues running

#### Scenario: Block-and-log policy

- **WHEN** a project config sets `onSecretViolation: "block-and-log"` and a violation occurs
- **THEN** the request is blocked and a violation event is logged to the sandbox logs

### Requirement: Env-var bridge for agent tools

The CLI SHALL set each tool's expected env var to the literal placeholder string (`.env("GITLAB_TOKEN", "$MSB_GITLAB_TOKEN_REAL")`) so that tools that read API keys from env vars work without modification. The env var holds the placeholder, not the real value. When the tool puts the placeholder in an outbound header (e.g., `Authorization: Bearer $MSB_GITLAB_TOKEN_REAL`), the TLS proxy substitutes it at the boundary.

#### Scenario: Tool reads env var and authenticates

- **WHEN** a sandbox is configured with `.env("GITLAB_TOKEN", "$MSB_GITLAB_TOKEN_REAL")` and a secret `GITLAB_TOKEN_REAL` scoped to `gitlab.com`, and a tool inside the sandbox reads `GITLAB_TOKEN` from env and sends it in an `Authorization: Bearer` header to `gitlab.com`
- **THEN** the proxy substitutes the placeholder with the real token and GitLab receives the valid `Authorization: Bearer <real-token>` header

#### Scenario: Multiple secrets work independently

- **WHEN** a sandbox is configured with two secrets (e.g., GitLab + OpenAI) each with their own env-var bridge and allowed host, and the tool sends both placeholders to their respective allowed hosts
- **THEN** each placeholder is substituted independently with its real value only for its allowed host

### Requirement: Secret value source

Secret values SHALL be read from host environment variables at sandbox creation time. The CLI SHALL NOT accept inline secret values (to avoid leaking into shell history or process listings). The host env var name SHALL map to the guest placeholder via the project config.

#### Scenario: Secret read from host env

- **WHEN** a project config specifies `secrets: [{ env: "GITLAB_TOKEN", from: "env:GITLAB_TOKEN", allow: "gitlab.com" }]` and the host has `GITLAB_TOKEN` exported
- **THEN** the CLI reads the value from the host env and passes it to the Secret builder; the guest receives the placeholder

#### Scenario: Missing host env var

- **WHEN** a project config references a secret from `env:GITLAB_TOKEN` but `GITLAB_TOKEN` is not set on the host
- **THEN** the CLI prints an error naming the missing env var and exits non-zero before creating the sandbox
