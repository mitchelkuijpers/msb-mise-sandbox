# Usage

## Commands

### build

```bash
agent-sandbox build
```

Builds the custom OCI image (`agent-sandbox:latest`) from the `Containerfile`
and loads it into the microsandbox runtime. Uses Docker for the build and
`msb image load` for the import.

Prerequisites: Docker must be installed and running.

### project add

```bash
agent-sandbox project add <name>
```

Interactively registers a new project in `~/.agent-sandbox/projects.json`.
Prompts for:

- **GitLab URL** — default `https://gitlab.com`
- **Token environment variable** — the host env var name (default
  `GITLAB_TOKEN`)
- **Additional secrets** — optionally add more secrets (env name, host
  source, allowed hosts)
- **Enable Docker support?** — whether to mount a disk-backed
  `/var/lib/docker` volume (requires the stock `agent-sandbox:latest`
  image). Default: no. See [Docker inside the Sandbox](#docker-inside-the-sandbox).

### project list

```bash
agent-sandbox project list
```

Lists all registered projects with their GitLab URL and secret names
(values are never displayed).

### project remove

```bash
agent-sandbox project remove <name>
```

Removes a project from the registry. Does not remove the sandbox — use
`agent-sandbox remove` for that.

### create

```bash
agent-sandbox create <project>
```

Creates a sandbox microVM from the registered project configuration. Uses
the `microsandbox` TS SDK to configure:

- OCI image (from `project.image`)
- CPU and memory limits (from `project.resources`)
- Workspace bind mount (current working directory → `/workspace`)
- Docker data volume at `/var/lib/docker` when `docker.enabled` is true
  (disk-backed `<project>-docker-data` volume, sized by `docker.dataVolumeSize`)
- Non-sensitive environment variables (from `project.env`)
- Secret placeholders (from `project.secrets`)
- Network policy (from `project.network`)

The sandbox is created in a running state.

### start

```bash
agent-sandbox start <project>
```

Resumes a stopped sandbox. The microVM state is preserved.

### stop

```bash
agent-sandbox stop <project>
```

Gracefully stops a running sandbox. The microVM state is preserved — use
`start` to resume.

### restart

```bash
agent-sandbox restart <project>
```

Stops (if running) and starts the sandbox.

### remove

```bash
agent-sandbox remove <project>
```

Removes a stopped sandbox from the microsandbox database. The project
registry entry is not affected — use `project remove` for that. If the
project had `docker.enabled: true`, the `<project>-docker-data` volume is
**preserved** (so pulled images and build cache survive re-creation) and
`remove` prints its name plus the `msb volume rm <project>-docker-data`
cleanup command.

### list

```bash
agent-sandbox list
```

Lists all sandboxes with their name, status, and creation date.

### shell

```bash
agent-sandbox shell <project>
```

Opens an interactive shell inside the sandbox. Uses the microsandbox SDK's
`attachShell()` which forwards the terminal TTY.

### exec

```bash
agent-sandbox exec <project> -- <command> [args...]
```

Runs a command inside the sandbox (non-interactive, TTY attached).

Examples:

```bash
agent-sandbox exec my-project -- mise --version
agent-sandbox exec my-project -- apt-get update
agent-sandbox exec my-project -- node --version
```

### opencode

```bash
agent-sandbox opencode <project>
```

Launches OpenCode inside the sandbox. Uses `Sandbox.attach("opencode")`
which runs the command interactively with the parent TTY attached.

### codex

```bash
agent-sandbox codex <project>
```

Launches Codex inside the sandbox. Uses `Sandbox.attach("codex")`.

> **Note:** Codex OAuth endpoint discovery is out of scope for this change.
> If you choose to use Codex, you may need to add manual `network.allow`
> rules for the hosts it needs.

### pi

```bash
agent-sandbox pi <project>
```

Launches Pi inside the sandbox. Uses `Sandbox.attach("pi")`.

> **Note:** Pi uses provider API keys via environment variables (e.g.,
> `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Configure these as secrets in the
> project registry with appropriate `network.allow` rules for the providers
> you use.

### doctor

```bash
agent-sandbox doctor
```

Runs health checks on the setup:

- `msb` CLI is installed and functional
- `msb doctor` passes
- `agent-sandbox:latest` image is cached in microsandbox
- `projects.json` is valid

## Project Configuration

Projects are stored in `~/.agent-sandbox/projects.json`. The full schema:

### `gitlab` (required)

```json
{
  "gitlab": {
    "url": "https://gitlab.com",
    "tokenRef": "env:GITLAB_TOKEN"
  }
}
```

- **url**: GitLab instance URL.
- **tokenRef**: Reference to the GitLab token source. Format:
  `env:VARIABLE_NAME` to read from the host environment.

### `secrets` (optional)

```json
{
  "secrets": [
    {
      "env": "GITLAB_TOKEN",
      "from": "env:GITLAB_TOKEN",
      "allow": "gitlab.com"
    },
    {
      "env": "OPENAI_API_KEY",
      "from": "env:OPENAI_API_KEY",
      "allow": ["*.openai.com", "api.openai.com"]
    }
  ]
}
```

- **env**: Environment variable name inside the sandbox. Becomes a
  placeholder (`$MSB_<env>`).
- **from**: Source of the real value on the host. Must be
  `env:VARIABLE_NAME`.
- **allow**: Host(s) allowed to receive this secret. Single string or array.
  Supports `*.` suffix patterns.

### `env` (optional)

```json
{
  "env": {
    "MY_VAR": "some-value",
    "LOG_LEVEL": "debug"
  }
}
```

Non-sensitive environment variables passed as-is to the sandbox. These are
not subject to placeholder substitution — they are set directly.

### `network` (optional)

```json
{
  "network": {
    "defaultEgress": "deny",
    "allow": [
      "gitlab.com:tcp:443",
      "*.openai.com:tcp:443",
      "registry.npmjs.org:tcp:443"
    ]
  }
}
```

- **defaultEgress**: `"deny"` (default) or `"allow"`. When `"deny"`, all
  outbound traffic is blocked unless explicitly allowed. DNS resolution is
  automatically permitted.
- **allow**: Array of rule strings in format `<host>:<protocol>:<port>`.

Rule format:

| Part | Description | Example |
|---|---|---|
| host | Exact domain or `*.` suffix pattern | `gitlab.com`, `*.openai.com` |
| protocol | `tcp` or `udp` | `tcp` |
| port | 1–65535 | `443` |

### `resources` (optional)

```json
{
  "resources": {
    "cpus": 4,
    "memory": "8G"
  }
}
```

- **cpus**: CPU core count (default: 4).
- **memory**: Memory limit string (default: `"8G"`). Supports `K`, `M`, `G`
  suffixes.

### `mounts` (optional)

```json
{
  "mounts": {
    "workspace": "/workspace",
    "root": "/root"
  }
}
```

- **workspace**: Bind mount target for the project directory (default:
  `/workspace`). Currently only workspace is mounted.
- **root**: Default home-directory path inside the sandbox (default: `/root`).
  It is kept in the schema for compatibility, but a blanket `/root` volume is
  not mounted because it would mask image content.

### `image` (optional)

```json
{
  "image": "agent-sandbox:latest"
}
```

OCI image reference. Default: `agent-sandbox:latest`.

### `docker` (optional)

```json
{
  "docker": {
    "enabled": true,
    "dataVolumeSize": "10G"
  }
}
```

- **enabled**: When `true`, sandbox creation mounts a disk-backed named
  volume (`<project>-docker-data`) at `/var/lib/docker`. This is required
  for `dockerd` — its overlay2 storage driver cannot stack on the sandbox's
  overlay rootfs. Default: `false`.
- **dataVolumeSize**: Size of the data volume: a positive integer with an
  uppercase `M` (MiB) or `G` (GiB) suffix, minimum `1024` MiB (`1G`).
  Default: `"10G"`. Examples: `"10G"`, `"50G"`, `"2048M"`.

Docker support requires the stock `agent-sandbox:latest` image (or its
`docker.io/library/agent-sandbox:latest` alias) — the engine, CLI, plugins,
and `docker-up` helper are baked into that image. Creation fails fast with
an actionable error if `docker.enabled: true` is paired with any other
image. See [Docker inside the Sandbox](#docker-inside-the-sandbox).

### `onSecretViolation` (optional)

```json
{
  "onSecretViolation": "block"
}
```

Action when a secret placeholder is sent to a non-allowed host:

| Value | Behavior |
|---|---|
| `"block"` (default) | Block request, continue |
| `"block-and-log"` | Block request and log violation |
| `"block-and-terminate"` | Terminate sandbox on violation |

## Secret Integration Patterns

### Basic: GitLab token for a single project

```bash
# On the host, set the token
export GITLAB_TOKEN=glpat-xxxxx

# During `project add`, accept defaults for GitLab URL and token env var.
# The token is now available to the agent as GITLAB_TOKEN.

# Network rule to allow GitLab access
# (added automatically — you provide it during project add or edit the JSON)
```

The agent reads `$GITLAB_TOKEN` from the environment inside the sandbox.
It sees the placeholder `$MSB_GITLAB_TOKEN`. When it connects to
`gitlab.com:443`, the microsandbox runtime substitutes the real token.

### Multiple secrets with different allowed hosts

```json
{
  "secrets": [
    {
      "env": "GITLAB_TOKEN",
      "from": "env:GITLAB_TOKEN",
      "allow": "gitlab.com"
    },
    {
      "env": "OPENAI_API_KEY",
      "from": "env:OPENAI_API_KEY",
      "allow": "*.openai.com"
    },
    {
      "env": "NPM_TOKEN",
      "from": "env:NPM_TOKEN",
      "allow": "registry.npmjs.org"
    }
  ]
}
```

Each secret is registered independently. The runtime only substitutes each
placeholder when connecting to its allowed host(s).

### Full isolation (no network)

```json
{
  "network": {
    "defaultEgress": "deny",
    "allow": []
  }
}
```

The sandbox has no outbound network access. Tools must be pre-installed in
the image.

### Allowing a host for OpenCode/Codex/Pi

If the agent needs to reach an API that is not in the allow list, add the
host to `network.allow`:

```json
{
  "network": {
    "allow": ["api.custom-service.com:tcp:443"]
  }
}
```

> **Note:** Codex OAuth endpoint discovery is intentionally not locked down
> in this change. If you use Codex, start by adding the specific hosts it
> needs to `network.allow` manually.

## Docker inside the Sandbox

The image ships Docker CE (`dockerd`, `docker` CLI, containerd, buildx,
compose v2). Docker is opt-in per project and requires a disk-backed
`/var/lib/docker` volume.

### Starting the daemon: `docker-up`

The microVM has no init system, so the daemon is started manually per boot
via the `docker-up` helper:

```bash
agent-sandbox exec my-project -- docker-up
# or from a shell inside the sandbox:
docker-up
```

`docker-up` is idempotent: it is a no-op (success) when `docker info`
already answers, starts `dockerd` in the background (log at
`/tmp/dockerd.log`) and waits up to 60s for readiness otherwise, and exits
non-zero with the log on failure. If `/var/lib/docker` is not a disk-backed
volume (e.g. Docker is enabled in config but the sandbox predates it), it
fails with an actionable error pointing at `docker.enabled`.

### Registry egress rules

Docker pulls are subject to the deny-by-default network policy. Add the
registry hosts to `network.allow` (all `:tcp:443`):

| Registry | Hosts |
|---|---|
| Docker Hub | `auth.docker.io`, `registry-1.docker.io`, `production.cloudfront.docker.com` (blob CDN). `production.cloudflare.docker.com` is the legacy CDN variant — include both to be safe. |
| ghcr.io | `ghcr.io`, `github.com` (auth), and the GitHub blob CDN (`*.githubusercontent.com` does not cover the CDN; check the redirect target if pulls fail). |

`docker.enabled` does **not** imply any network rules — add them explicitly.

### Cache persistence and cleanup

The `<project>-docker-data` volume persists across `agent-sandbox remove`,
so pulled images and build cache survive sandbox re-creation. On removal,
the CLI prints the preserved volume name and the cleanup command:

```bash
msb volume rm my-project-docker-data
```

### Memory guidance

Running containers share the sandbox's CPU/memory limits, and `dockerd`
plus image builds are memory-hungry. Raise `resources.memory` for large
builds (the image default is `8G`; the microsandbox Docker-in-sandbox recipe
baseline is `2G`):

```json
{
  "resources": { "cpus": 4, "memory": "16G" },
  "docker": { "enabled": true, "dataVolumeSize": "50G" }
}
```

## Environment Variables

The CLI itself accepts:

| Variable | Description |
|---|---|
| `GITLAB_TOKEN` | GitLab personal access token (referenced by `tokenRef`) |
| (any secret source) | Any host env var referenced by a secret's `from` field |

All configuration (image, resources, network rules, secrets) is stored in
the project registry, not in environment variables. Use `agent-sandbox
project add` or edit `~/.agent-sandbox/projects.json` directly.

## Troubleshooting

**Build fails**
```bash
docker build --load -t agent-sandbox:latest -f Containerfile .
```
If Docker is not running or the network is flaky, retry. The build script
retries apt operations up to 3 times.

**Sandbox creation fails**
```bash
agent-sandbox doctor
```
Check that `msb doctor` passes and the image is cached.

**Secret not substituted**
- Verify the host environment variable is set and non-empty.
- Verify the `from` field uses `env:VARIABLE_NAME` format.
- Verify the host the agent is connecting to matches an `allow` entry.
- Check the violation policy: if it's `"block"`, the connection is silently
  dropped.

**Network rule not working**
- Verify the rule format: `<host>:<protocol>:<port>`.
- For subdomain patterns, use `*.example.com` (not `*example.com` or
  `*.example.com:*`).
- DNS must be resolvable. When `defaultEgress` is `"deny"`, DNS is
  automatically allowed.

## Manual Validation Notes

The following areas have not been fully validated and may require manual
testing:

- **Codex network rules**: Codex OAuth endpoint discovery is out of scope
  for this change. If you use Codex, add the required hosts to
  `network.allow` manually.
- **Pi network rules**: Pi uses provider API keys (Anthropic, OpenAI, etc.).
  Add the required hosts to `network.allow` manually. Provider API keys should
  be configured as secrets in the project registry.
- **Tool-specific auth behavior**: the core placeholder mechanism is verified,
  but each agent still depends on its own expected env var names and provider
  configuration. If a specific tool fails to authenticate, confirm that the
  correct secret/env var and `network.allow` hosts are configured.
