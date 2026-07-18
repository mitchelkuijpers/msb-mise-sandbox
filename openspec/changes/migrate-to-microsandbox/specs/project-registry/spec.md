## ADDED Requirements

### Requirement: Project registry configuration file

The CLI SHALL maintain a project registry at `~/.agent-sandbox/projects.json` containing per-project configuration. Each project entry SHALL include: GitLab URL, token reference, secrets, env vars, network allow rules, resource limits, and mount configuration.

#### Scenario: Registry file created on first project add

- **WHEN** the user runs `agent-sandbox project add <name>` and `~/.agent-sandbox/projects.json` does not exist
- **THEN** the CLI creates the file with the new project entry and a valid JSON schema

#### Scenario: Registry validated on load

- **WHEN** the CLI loads `projects.json` and the file is malformed or fails schema validation
- **THEN** the CLI prints a validation error identifying the problem and exits non-zero

### Requirement: Project configuration schema

Each project entry in the registry SHALL conform to a typed schema with the following fields: `gitlab` (url, tokenRef), `secrets` (array of env/from/allow), `env` (map of non-sensitive vars), `network` (defaultEgress, allow array), `resources` (cpus, memory), and `mounts` (workspace, root).

#### Scenario: Full project config

- **WHEN** a project entry includes gitlab url, token ref, two secrets, env vars, network allow rules, resource limits, and mount config
- **THEN** the CLI applies all fields to the sandbox builder when creating the sandbox

#### Scenario: Defaults applied for omitted fields

- **WHEN** a project entry omits `resources` or `mounts`
- **THEN** the CLI applies default values (4 CPUs, 8G memory; workspace mount to `/workspace`, named volume for `/root`)

### Requirement: Project add command

The CLI SHALL provide `agent-sandbox project add <name>` to interactively register a new project. The command SHALL prompt for GitLab URL, token source (host env var name), and any additional secrets, and write the entry to the registry.

#### Scenario: Add a project interactively

- **WHEN** the user runs `agent-sandbox project add myproject` and provides a GitLab URL and token env var name
- **THEN** the CLI writes a new entry to `projects.json` with the provided values and default network/resource/mount config

#### Scenario: Duplicate project name rejected

- **WHEN** the user runs `agent-sandbox project add <name>` and a project with that name already exists
- **THEN** the CLI prints an error and exits non-zero without modifying the registry

### Requirement: Project list and remove commands

The CLI SHALL provide `agent-sandbox project list` to print all registered projects and `agent-sandbox project remove <name>` to delete a project from the registry.

#### Scenario: List all projects

- **WHEN** the user runs `agent-sandbox project list` and the registry contains three projects
- **THEN** the CLI prints each project name, GitLab URL, and configured secrets (without real values)

#### Scenario: Remove a project

- **WHEN** the user runs `agent-sandbox project remove <name>` and the project exists
- **THEN** the CLI removes the entry from `projects.json` and prints a confirmation

#### Scenario: Remove non-existent project

- **WHEN** the user runs `agent-sandbox project remove <name>` and the project does not exist
- **THEN** the CLI prints an error and exits non-zero

### Requirement: GitLab project scoping

Each project entry SHALL reference a GitLab project URL and a token source. The token SHALL be injected as a secret scoped to `gitlab.com` (SaaS) so it can only be used for that host. Project-level access restriction (which projects the token can touch) SHALL be enforced by GitLab via the token's scope, not by the sandbox.

#### Scenario: GitLab token scoped to gitlab.com

- **WHEN** a project config specifies `gitlab.tokenRef: "env:GITLAB_TOKEN"` and `secrets` includes `{ env: "GITLAB_TOKEN", from: "env:GITLAB_TOKEN", allow: "gitlab.com" }`
- **THEN** the token is injected as a secret that can only be substituted for traffic to `gitlab.com`

#### Scenario: Token project-scoping is GitLab's responsibility

- **WHEN** a GitLab token with broader scope than intended is provided
- **THEN** the sandbox does not restrict which GitLab projects the token can access; that restriction MUST be enforced by using a Project Access Token scoped to the target project at creation time

### Requirement: Secret and env var configuration

Each project entry SHALL configure secrets (sensitive values, host-injected with allowed hosts) and env vars (non-sensitive config, passed as plain environment variables to the guest).

#### Scenario: Secret configured with allowed host

- **WHEN** a project config includes `secrets: [{ env: "OPENAI_API_KEY", from: "env:OPENAI_API_KEY", allow: "api.openai.com" }]`
- **THEN** the CLI calls the Secret builder with the host env value and `allowHost("api.openai.com")`

#### Scenario: Non-sensitive env var configured

- **WHEN** a project config includes `env: { "OPENCODE_API_BASE": "https://api.openai.com/v1" }`
- **THEN** the CLI calls `.env("OPENCODE_API_BASE", "https://api.openai.com/v1")` and the value is visible in the guest environment as-is
