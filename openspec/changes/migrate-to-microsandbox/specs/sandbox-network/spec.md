## ADDED Requirements

### Requirement: Deny-by-default egress

The CLI SHALL configure all sandboxes with deny-by-default egress network policy. No outbound traffic SHALL be allowed unless explicitly permitted by a per-project allow rule.

#### Scenario: No traffic without allow rules

- **WHEN** a sandbox is created with deny-by-default egress and no allow rules
- **THEN** all outbound network traffic is blocked, including DNS

#### Scenario: Only allowed hosts are reachable

- **WHEN** a project config allows `gitlab.com:443` and `api.openai.com:443` and the guest attempts to reach `example.com`
- **THEN** the connection to `example.com` is blocked and the connections to `gitlab.com` and `api.openai.com` on port 443 are allowed

### Requirement: Per-project allow rules

The CLI SHALL read network allow rules from the project registry and apply them as microsandbox network policy rules. Each rule SHALL specify a target (domain, domain suffix, or IP/CIDR), protocol, and port.

#### Scenario: Allow a specific domain on port 443

- **WHEN** a project config includes `network.allow: ["gitlab.com:tcp:443"]`
- **THEN** the CLI adds an egress allow rule for `gitlab.com` on TCP port 443

#### Scenario: Allow a domain suffix

- **WHEN** a project config includes `network.allow: ["*.openai.com:tcp:443"]`
- **THEN** the CLI adds an egress allow rule matching all subdomains of `openai.com` on TCP port 443

### Requirement: DNS resolution

The CLI SHALL include a DNS allow rule in every project's network policy so that the guest can resolve allowed hostnames. DNS queries SHALL be allowed to the host gateway on UDP/TCP port 53.

#### Scenario: DNS resolves allowed hostnames

- **WHEN** a sandbox is created with deny-by-default egress, an allow rule for `gitlab.com:443`, and a DNS allow rule
- **THEN** the guest can resolve `gitlab.com` to an IP and connect to it on port 443

#### Scenario: DNS blocked without allow rule

- **WHEN** a sandbox is created with deny-by-default egress and no DNS allow rule
- **THEN** hostname resolution fails and no outbound connections can be established

### Requirement: TLS interception for secret substitution

The CLI SHALL enable TLS interception (the microsandbox built-in TLS proxy) for sandboxes that use secrets, so that placeholder substitution can occur at the network boundary. TLS interception SHALL apply to port 443 by default.

#### Scenario: TLS interception enabled with secrets

- **WHEN** a sandbox is created with one or more secrets
- **THEN** the microsandbox TLS proxy is enabled on port 443 and inspects outbound HTTPS traffic for placeholder substitution

#### Scenario: TLS interception not needed without secrets

- **WHEN** a sandbox is created with no secrets
- **THEN** TLS interception is not required and traffic to allowed hosts proceeds without inspection

### Requirement: Codex OAuth network access

The CLI SHALL include network allow rules for the Codex/ChatGPT OAuth flow endpoints in projects that use the `codex` command. The exact endpoints SHALL be confirmed during implementation by observing the OAuth flow; initial candidates are `auth.openai.com:443` and `chatgpt.com:443`.

#### Scenario: Codex OAuth flow completes

- **WHEN** a project config enables codex and includes OAuth endpoint allow rules and the user runs `agent-sandbox codex <project>` then completes the OAuth flow
- **THEN** the OAuth endpoints are reachable, the flow completes, and the token persists in the `/root` named volume

#### Scenario: Non-OAuth hosts blocked during codex use

- **WHEN** a project config enables codex with only OAuth + API endpoints allowed and the agent attempts to reach an unrelated host
- **THEN** the connection is blocked by the network policy
