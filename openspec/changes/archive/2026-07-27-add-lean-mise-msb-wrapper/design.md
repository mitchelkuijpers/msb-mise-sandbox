## Context

The sandbox CLI (`src/cli.ts`, `src/lib/`, `src/commands/`) currently wraps the microsandbox TypeScript SDK (`microsandbox@0.6.6`) to manage microVM-based coding-agent sandboxes. Per-project configuration is stored in a central JSON registry at `~/.agent-sandbox/projects.json` with a typed schema, loaded by `src/lib/config.ts`, and applied at sandbox-creation time via `src/lib/sandbox.ts` which constructs `Sandbox.builder()` calls with `cpus`, `memory`, `volume`, `env`, `network`, and port-forwarding options. Secrets use the env-var bridge pattern (`.env("GITLAB_TOKEN", "$MSB_GITLAB_TOKEN_REAL")` with secrets on the `NetworkBuilder`), and image construction is Docker-based (`Containerfile` → `docker build` → `msb image load`).

This approach has several drawbacks that the proposal identifies:

- The SDK adds a non-trivial dependency (native napi-rs bindings, v0.6.6 pin, TS SDK bug with `SandboxBuilder.secret()`).
- The central `projects.json` registry requires interactive `project add` commands, schema validation code, and a mutable global file.
- Image building requires Docker (or Podman), adding a second container runtime dependency beyond microsandbox itself.
- The SDK's lifecycle helpers (`Sandbox.get()`, `Sandbox.startDetached()`) mix in-process JavaScript objects with out-of-process VM state, creating confusion around status management.
- Agent-specific commands (`opencode`, `codex`, `pi`) embed launch logic that is better owned by the tools themselves.

`mise` (already installed, manages tool versions via `mise.toml`) now has experimental `mise oci build` — a command that produces an OCI image layout directly from a `mise.toml` toolset without a Containerfile or Docker. `msb` (the microsandbox CLI) provides a complete lifecycle surface (`msb create`, `msb start`, `msb stop`, `msb exec`, `msb shell`, `msb remove`, `msb list`, `msb image load`, `msb volume`) that already handles all sandbox operations. Together, `mise` and `msb` subsume the SDK's role.

This design replaces the SDK-and-registry CLI with a stateless, transparent Bun/TypeScript wrapper that loads layered TOML configuration, generates the equivalent `msb` CLI commands, optionally prints them for inspection, and executes them. It removes Docker as a build dependency by using `mise oci build` in a Linux builder, removes the central registry in favor of per-project `.sandbox.toml` files, and removes agent-specific commands in favor of a generic `exec` surface.

## Goals / Non-Goals

**Goals:**

- **Replace the microsandbox TS SDK** with direct `msb` CLI subprocess calls via Bun's `Bun.spawn`/`Bun.spawnSync`. No `microsandbox` npm dependency.
- **Layered TOML configuration** with four ordered layers: built-in defaults → personal defaults (`~/.config/mise-msb/config.toml`) → project config (`.sandbox.toml`) → CLI flag overrides. Each layer merges deterministically into the next, with later layers overriding earlier ones.
- **Deterministic TOML merge rules** for every configurable section: resources (last wins), environment variables (merged map, later wins), network allow rules (appended, deduplicated), secrets (merged by key, later wins), mounts (merged map, later wins), image settings (last wins), and commands (last wins). Array fields append with deduplication; map fields merge with later keys overriding.
- **Linux-hosted `mise oci build` workflow** that creates an OCI image layout from the project's `mise.toml`, archives it, and imports it into the local microsandbox image cache via `msb image load`. The build executes inside a Linux OCI builder container to avoid embedding macOS-native binaries.
- **Generic lifecycle commands** — `build`, `create`, `run` (create + start), `shell`, `exec`, `stop`, `remove` — that translate configuration directly into `msb` argv. No agent-specific commands.
- **Transparent print mode**: a `--print` (or `--dry-run`) flag on lifecycle commands prints the generated `msb` CLI command to stdout instead of executing it, enabling inspection and manual use.
- **Idempotent install command**: `mise-msb install [--force]` symlinks the tool into `~/.local/bin/mise-msb`. It does not modify shell startup files. When `--force` is absent and the target already exists, it reports the existing and desired targets and refuses to replace the entry. It prints a PATH warning if `~/.local/bin` is not in `$PATH`.
- **Secret safety**: secret values are never written into TOML configuration files, read into wrapper state, or included in argv. The TOML config names host environment variables and allowed hosts only; the wrapper emits `msb --secret ENV@HOST`, and `msb` reads the value from the host environment at start time.
- **Removal of the central registry**: no `~/.agent-sandbox/projects.json`, no interactive `project add/list/remove` commands, no schema validation for a mutable global registry.
- **Removal of Docker-specific lifecycle**: the wrapper does not manage `dockerd` startup, Docker volumes, or Docker data volume persistence. Docker becomes an optional base-image and generic-mount concern handled entirely by the user's `.sandbox.toml` and `mise.toml`.

**Non-Goals:**

- **No SDK dependency**: the wrapper does not import or bundle the microsandbox TypeScript SDK. All sandbox interaction goes through the `msb` CLI.
- **No shell startup file modification**: `install` creates a symlink only; it does not edit `~/.zshrc`, `~/.bashrc`, `~/.profile`, or any other dotfile.
- **No central project registry**: projects are self-contained in their checked-in `.sandbox.toml`. There is no global mutable state.
- **No agent-specific commands**: `opencode`, `codex`, and `pi` are removed. Users run `mise-msb exec <project> -- opencode` or use the tool directly.
- **No Docker-as-build-dependency**: image building uses `mise oci build` in a Linux builder, not `docker build`.
- **No interactive prompts**: the wrapper is stateless and non-interactive. Configuration is in TOML files and CLI flags.
- **No Windows support**: the wrapper targets macOS (for development) and Linux (for the OCI builder). Windows is not considered.

## Decisions

### D1: Bun/TypeScript over Bash or Rust

**Choice**: Rewrite the CLI as a single-file or small-module Bun/TypeScript program using `Bun.spawn()` and `Bun.spawnSync()` for subprocess management, and `Bun.file()` with `TOML.parse()` from the built-in `bun` module for configuration loading.

**Why**:
- TypeScript provides typed interfaces for the layered TOML config, the CLI argument schema, and the merge rules — catching structural errors at parse time rather than at runtime.
- Bun's built-in TOML parser and `Bun.spawn` API eliminate the need for external packages (no `toml` npm package, no `child_process` promisify boilerplate).
- The wrapper is stateless and thin — the core logic is config loading + argv construction + subprocess execution. This is a poor fit for Rust's complexity (binary distribution, build toolchain) and a manageable fit for TypeScript's runtime cost.
- The project already uses Bun (`package.json` has `bun test`, `bun src/cli.ts`). Staying in the existing runtime avoids a new toolchain.
- Bash would be simpler for the subprocess dispatch but would lack structured config handling for the layered TOML merge logic without resorting to `yq`/`jq` or complex string parsing.

**Alternatives considered**:
- **Bash wrapping `msb`**: fine for simple lifecycle dispatch, but the layered TOML merge, validation, and redaction logic would be fragile in pure bash. Adding `yq` as a dependency trades one problem for another.
- **Rust CLI**: the `msb` CLI is Rust, but writing a wrapper in Rust means either shelling out to `msb` anyway (pointless rewrite) or using the Rust SDK directly (re-adds the SDK dependency this change removes). The wrapper is ~300-500 lines; Rust's compile-time safety does not justify the binary-distribution and build-toolchain overhead for a local developer tool.
- **Python**: viable (excellent TOML support, subprocess module), but adds a third runtime (Bun + Python + msb) when the project already standardizes on Bun. The agent ecosystem (OpenCode) is TS-centric, making TypeScript the more natural choice for any future hooks.

### D2: Layered TOML precedence with deterministic merge rules

**Choice**: Four configuration layers, each overriding the previous:

1. **Built-in defaults** — hardcoded in source: glibc-based `build.from`, local `<project>:dev` tag, `runtime.cpus = 4`, `runtime.memory = "8G"`, workspace target `/workspace`, allow-by-default egress (projects that want a deny-by-default policy set `network.defaultEgress = "deny"` explicitly), and empty named `env`, `secrets`, `mounts`, and `ports` tables.
2. **Personal defaults** — `~/.config/mise-msb/config.toml`. Optional file for user-wide overrides (e.g., default CPU count on a beefy machine, personal GitLab token env-var name, preferred image).
3. **Project configuration** — `<project-dir>/.sandbox.toml`. Checked into the project repo. The primary configuration artifact for a sandboxed project.
4. **CLI flag overrides** — focused overrides such as `--cpus`, `--memory`, `--image`, and repeatable network or port options. Provided at invocation time for ad-hoc changes without introducing a second configuration language.

**Deterministic merge rules per section**:

| Section | Merge strategy |
|---|---|
| scalar fields such as image, tag, CPU, and memory | Last non-empty value wins |
| `env` (map) | Deep merge, later keys override earlier |
| named `secrets`, `mounts`, and `ports` tables | Merge by entry name; later entry replaces a conflicting earlier entry |
| `network.allow` (array of strings) | Append with deduplication unless the overlay sets `network.inherit = false` |
| `network.defaultEgress` | Last non-null value wins |
| command arrays | Replace rather than concatenate |

The merge is implemented as a pure function `mergeConfig(base: PartialConfig, overlay: PartialConfig): Config` that processes each section according to its rule. This function is the single source of truth for configuration composition and is independently unit-tested.

**Why**:
- The layering mirrors established patterns (Git config, mise config) and gives users a clear mental model: personal overrides → project defaults → CLI overrides.
- Deterministic per-section rules avoid ambiguity. A TOML file that specifies `env.FOO = "x"` at the personal layer and `env.FOO = "y"` at the project layer knows exactly which wins.
- No schema registry, no validation at rest — the TOML files are simple key-value documents. Structural validation happens at load/merge time.
- The merge function is pure and testable; edge cases (empty layers, conflicting types, missing files) are covered by unit tests.

**Alternatives considered**:
- **Single layer (project config only)**: simpler but forces every user to either fork `.sandbox.toml` or pass CLI flags every time. The personal-defaults layer reduces friction for common overrides.
- **JSON instead of TOML**: TOML is already the project convention (mise uses `mise.toml`), supports comments, is more human-friendly for hand-edited config, and Bun natively parses it.
- **YAML**: not natively supported by Bun; would require an external parser dependency.
- **Deep merge for all sections (including arrays)**: appending with deduplication for arrays is more predictable than deep-merge for lists (which risks duplicates). For maps the deep-merge is natural.

### D3: Safe argv generation without secret values

**Choice**: The wrapper does not resolve or hold secret values. A secret configuration names the guest environment variable, source host environment variable, and allowed hosts. The wrapper emits a placeholder as a non-secret guest environment value when the guest name differs from the source name, then passes each source-host pair as `--secret SOURCE_ENV@HOST`. The `msb` process reads the source value from its inherited host environment and rejects inline secret values.

**Why**:
- The wrapper never stores secret values in parsed configuration, generated commands, logs, or argv. Values remain exclusively in the inherited host environment and microsandbox runtime.
- Current `msb` syntax is explicit and source-based: `["--secret", "GITLAB_TOKEN@gitlab.com"]`. Inline `ENV=VALUE@HOST` syntax is rejected by `msb`.
- `--print` is safe by construction because generated commands contain source environment variable names, not their values. There is no `--no-redact` escape hatch.
- Before execution, the wrapper verifies that every referenced source environment variable is present without reading or printing its value.

**Alternatives considered**:
- **Pass secrets inline, via stdin, or via temp files**: unnecessary and less safe because `msb` already resolves named variables from the inherited host environment.
- **Read values and add them to argv**: rejected because command-line arguments can be exposed through process inspection and current `msb` deliberately rejects inline values.

### D4: Linux mise OCI builder via `msb` OCI load

**Choice**: The `build` command invokes `mise oci build` directly on Linux. On macOS it starts an ephemeral Linux builder with `msb`, bind-mounts the project read-only and a host output directory read-write, and invokes the same mise command there. In both cases the host archives the generated OCI layout and imports it with `msb image load --input <archive> --tag <tag>`.

**Why**:
- `mise oci build` on macOS embeds x86_64/arm64 macOS binaries into the image, making it unusable for Linux microVMs. The build must execute on Linux.
- A configurable Linux builder image containing mise and its basic installation dependencies can run `mise oci build` and write the result directly through the output bind mount.
- `msb image load` accepts a tarred OCI Image Layout, matching the directory produced by `mise oci build`.
- This removes Docker as a build dependency and uses the same isolation runtime for image construction and execution.

**Build workflow**:

1. Verify that `msb`, `tar`, and the configured build inputs are available.
2. Create a temporary host output directory outside the project worktree.
3. On Linux, run `MISE_EXPERIMENTAL=1 mise oci build --from <base> --tag <tag> --output <output>/layout` directly from the project root.
4. On macOS, run the configured builder image with the project mounted read-only at `/workspace` and the output directory mounted read-write at `/out`, then run the same command with output `/out/layout`.
5. On the host, archive the layout with `tar -C <output>/layout -cf <output>/image.tar .`.
6. Import it with `msb image load --input <output>/image.tar --tag <tag>`.
7. Clean up temporary build output according to the selected retention setting.
8. Print the imported image digest and tag.

**Why `mise oci build` over `Containerfile` + `docker build`**:
- Single source of truth: tool versions live in `mise.toml`; the image is derived directly from them.
- No Containerfile to maintain; no apt/dpkg layer.
- Smaller images (only the tools, no build-time dependencies).
- Faster iteration (change a tool version in `mise.toml`, rebuild).

**Alternatives considered**:
- **Keep `docker build` + Containerfile**: requires Docker installed, diverges from the mise-centric vision, and adds maintenance burden for the Containerfile and apt dependencies.
- **Cross-compile OCI layout on macOS**: not supported by `mise oci build` (it embeds host binaries). A future version of mise might support `--target linux/amd64`; when it does, the builder step can be removed.
- **Pre-built base images from a registry**: loses the tool-version pinning that mise provides; forces users to maintain external images.

### D5: Transparent print mode (`--print` / `--dry-run`)

**Choice**: Every lifecycle command that spawns `msb` (`create`, `run`, `stop`, `remove`, `shell`, `exec`) accepts a `--print` flag. When set, the wrapper prints the full `msb` command argv to stdout and exits without executing. The output is formatted as a shell command line that can be copied and pasted; secret arguments contain environment variable names only, never values.

**Why**:
- Transparency: users can see exactly what `msb` commands the wrapper generates, inspect them for correctness, and learn the `msb` CLI surface.
- Debugging: when a sandbox operation fails, `--print` isolates whether the issue is in config generation or `msb` execution.
- Manual fallback: if the wrapper has a bug, users can copy the printed command and run it directly with `msb`.
- The `--print` output includes comment lines (`#`) showing the source of each flag (which TOML layer and key).

**Why `--print` over a separate `generate` subcommand**: a flag keeps the interface simple — every command can be inspected before execution. A `generate` subcommand would double the command surface and require parallel maintenance.

### D6: No central registry — per-project `.sandbox.toml` instead

**Choice**: Remove `~/.agent-sandbox/projects.json` and the associated `project add/list/remove` commands. Each project carries its own configuration in a checked-in `.sandbox.toml` file. The wrapper discovers `.sandbox.toml` by walking up from `cwd` (like `mise.toml` discovery) or accepts an explicit `--config` path.

**Why**:
- **Decentralized**: project configuration lives with the project. No global mutable state. Branching, reviewing, and reverting config changes is normal Git workflow.
- **No interactive registration**: there is nothing to register. `cd` into a project directory; the config is found automatically.
- **No schema drift**: the central registry schema could fall behind; per-project files are parsed and validated at each invocation against the current wrapper version.
- **No token references in a global file**: secret env-var names are in the project's `.sandbox.toml`; if someone gains access to the project repo, they see which env vars are used but not the values themselves (which remain in host env / secret manager).

**Project discovery**:
1. If `--config <path>` is given, use that file directly.
2. Otherwise, start at `cwd` and walk up to the filesystem root, looking for `.sandbox.toml` (same algorithm `mise` uses for `mise.toml`).
3. If not found, fall back to `~/.config/mise-msb/config.toml` alone (no project config).
4. Warn if no config is found (informs the user that defaults apply).

**Alternatives considered**:
- **Keep `projects.json` but remove interactive commands**: still requires a global file, schema maintenance, and the mental overhead of "registering" a project. Per-project files are simpler and more aligned with mise's design.
- **Environment-variable-only config**: no config files at all; everything via `MISE_MSB_*` env vars and CLI flags. Impractical for anything beyond trivial use — users would need to alias or script every invocation.

### D7: Generic lifecycle over agent-specific commands

**Choice**: Provide a flat set of lifecycle subcommands — `build`, `create`, `run`, `shell`, `exec`, `stop`, `remove`, `list` — and remove the agent-specific commands (`opencode`, `codex`, `pi`). Users run their agent inside the sandbox via `mise-msb exec <name> -- opencode` or by passing a command to `run`.

**Why**:
- The wrapper's job is configuration + sandbox lifecycle, not agent orchestration. Agent-specific commands were thin wrappers over `msb exec -- opencode`; removing them eliminates maintenance without losing functionality.
- `exec` is generic: `mise-msb exec myproject -- opencode` and `mise-msb exec myproject -- codex` work identically.
- `run <name> [-- cmd...]` creates the sandbox (if not existing), starts it, and optionally execs a command — a convenience that replaces the most common agent-launch pattern.
- The `--print` flag works on `run` too: `mise-msb run myproject --print` shows what `msb create`, `msb start`, and `msb exec` commands would be executed.

**Command reference**:

| Command | Purpose |
|---|---|
| `build [--builder <type>]` | Build OCI image from `mise.toml` via Linux OCI builder and load into microsandbox |
| `create <name>` | Create a sandbox from merged config (no start) |
| `run <name> [-- cmd...]` | Create (if missing) + start + exec command (or open shell) |
| `shell <name>` | Open interactive shell |
| `exec <name> -- <cmd>` | Execute a single command |
| `stop <name>` | Stop a running sandbox |
| `remove <name>` | Remove a sandbox |
| `list` | List all sandboxes |
| `install [--force]` | Symlink wrapper into `~/.local/bin` |
| `config` | Print the merged configuration (all layers) for inspection |

All lifecycle commands accept `--print` to display generated `msb` argv.

### D8: Idempotent symlink install with `--force` and PATH warning

**Choice**: `mise-msb install` creates a symbolic link from `~/.local/bin/mise-msb` pointing to the wrapper entry point. If the link already exists and points to a different target, the command reports the existing and desired targets and suggests `--force`. `--force` replaces the existing link. After creating the link, the command checks whether `~/.local/bin` is in `$PATH` and prints a warning if it is not.

**Why**:
- Symlinks are idempotent: the same install run twice produces the same result. No state file, no install manifest.
- The `--force` guard prevents accidentally overwriting a user's existing `mise-msb` binary that might be installed via another mechanism (Homebrew, cargo, etc.).
- The PATH warning is a non-fatal informational message (exit code 0). Users can suppress it with `--quiet`.
- No shell startup file modification: many users have strong opinions about their dotfiles; the wrapper does not touch them. Users can add `~/.local/bin` to PATH themselves or follow the printed hint.
- The install command doubles as a mise task in the project's `mise.toml`, so `mise run install` inside the project repo installs the tool.

**Alternatives considered**:
- **Install via npm/cargo**: adds a distribution channel dependency and publishing overhead. The tool is a single Bun file; symlinking from the repo or a release tarball is simpler.
- **`cp` instead of symlink**: a copy becomes stale when the wrapper is updated. A symlink always points to the current source.
- **Automatic PATH modification via `echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.zshrc`**: too invasive; users should own their shell configuration.

## Risks / Trade-offs

- **[`mise oci build` is experimental]** → `mise oci build` is not yet stable. The build command must detect failures from the builder and fall back gracefully (e.g., suggesting the user revert to `docker build` with the old Containerfile). The OCI layout format and flags may change across mise releases. Pin a minimum mise version in the wrapper's install check.
- **[Linux builder is slow on first macOS use]** → The first macOS build must pull the configured mise-enabled Linux builder image. Subsequent builds reuse the microsandbox image cache; users can pre-cache it with `msb image pull`.
- **[No Windows support]** → The wrapper relies on `~/.local/bin` conventions, `Bun.spawn`, and assumes a POSIX-like environment. Cross-platform support is out of scope.
- **[Layered TOML complexity]** → The four-layer merge is more complex than a single config file. The risk is mitigated by a pure-function merge with comprehensive unit tests and a `config` command that prints the final merged configuration for debugging.
- **[Breaking change for existing users]** → The migration removes `projects.json`, changes command names, and removes agent subcommands. Explicit migration instructions (see below) and the `--print` mode ease the transition. The old CLI remains in git history.
- **[Secret source names are visible in printed commands]** → This is intentional and safe for committed configuration; values are never resolved or printed by the wrapper.
- **[macOS bind mount path mismatch]** → On macOS, `cwd` is typically `/Users/me/project` which `msb` must translate to the microVM mount. microsandbox handles this translation transparently, but users should be aware that macOS paths are resolved at create time, not symlink-followed.
- **[`mise` required for build but not for run]** → Running existing sandboxes only needs `msb`. Building new images requires `mise` in the Linux builder. The `doctor` subcommand (or `build --check`) verifies that `mise` is available.
- **[`~/.config/mise-msb/` directory owned by wrapper]** → The wrapper creates `~/.config/mise-msb/` on demand (when writing personal defaults or reading them). Permissions: `0700` for the directory, `0600` for files. The personal defaults file is optional and may not exist.
- **[`bun` binary required at runtime]** → Unlike the compiled Rust SDK, the wrapper requires `bun` to interpret the TypeScript source. This is acceptable for a developer tool (the project already uses Bun) but means the installed symlink transitions through `bun run` or the Bun shebang. The install command checks that `bun` is on `PATH` and produces a clear error if not.

## Migration Plan

The following steps transition from the current SDK-based CLI to the new wrapper. The migration is designed to be done in a single atomic change; existing sandboxes and configuration are not automatically migrated.

1. **Write the wrapper** (`src/mise-msb.ts` or equivalent entry point). Implement the layered TOML loader, merge logic, argv construction, `--print` mode, and lifecycle subcommands. No SDK import. No registry code.

2. **Write the install command and mise task**. The wrapper's `install` command creates the symlink. Add a `[tasks.install]` entry to `mise.toml` so `mise run install` inside the repo installs the tool.

3. **Remove obsolete source files**:
   - `src/cli.ts`, `src/commands/*.ts` (all 16 files), `src/lib/*.ts` (all 4 files), `src/types.ts`.
   - `tests/` files that test the removed SDK/registry code.
   - `~/.agent-sandbox/projects.json` is no longer read or written. Users should `rm -rf ~/.agent-sandbox` after confirming their projects have `.sandbox.toml` files.

4. **Remove the SDK dependency**: `bun remove microsandbox` and delete the associated `napi-rs` native bindings from `node_modules/`.

5. **Update `package.json`**: change `"name"` if desired, update `"bin"` to point to the new entry point, remove unused deps, add any new deps (the wrapper aims for zero runtime deps beyond Bun built-ins).

6. **Update `tsconfig.json`** if needed for the new entry point structure.

7. **Write tests**: unit tests for `mergeConfig` (all sections, edge cases, empty layers), integration tests for `--print` output against known config inputs, and a smoke test that verifies `mise-msb install --print` or `mise-msb config --print` works without a real `msb` installation.

8. **Update documentation**: `docs/`, `README.md`, and any `ARCHITECTURE.md` to reflect the wrapper design. Document the TOML schema, merge rules, and migration from the old CLI.

9. **Archive the Docker and project-registry specs**: the `sandbox-docker` spec moves to archive; the Docker-in-sandbox feature is now an optional user concern, not a wrapper responsibility.

10. **Run smoke tests**: create a minimal `.sandbox.toml`, run `mise-msb create --print`, verify the generated `msb` argv is correct. Run `mise-msb config` and verify merged output.

**Rollback**: The old SDK-based CLI remains in git history. To roll back, revert the deletion of `src/commands/` and `src/lib/`, restore `package.json` dependencies, and `git revert` the migration commit. The `.sandbox.toml` files are forward-compatible (they can be hand-converted back to `projects.json` entries).

**Backward compatibility for projects.json users**: The wrapper does not read `projects.json`. Users who want to keep existing projects must translate their registry entries to `.sandbox.toml` files. A recommended migration workflow:

```
# For each project in ~/.agent-sandbox/projects.json:
cd ~/projects/myproject
mise-msb config --init  # creates .sandbox.toml with current dir defaults
# Manually copy env vars, secrets refs, network rules, mounts from the registry entry
# Then verify: mise-msb config
# Then test: mise-msb run myproject -- ls
```

## Open Questions

- **Q1: Should the wrapper include a `doctor` command?** The proposal does not list it, but a `doctor` (or `check`) command that verifies `msb` is installed, `bun` is on PATH, the config is valid, and the OCI image exists would be a natural addition. Answer at implementation time based on user feedback; speculative inclusion adds ~50 LOC.

- **Q2 (resolved): Linux builder type — `msb` microVM or Docker container?** Use `msb`. The spike successfully ran Linux `mise oci build` in an `msb` microVM, wrote the OCI layout through a host mount, loaded it with `msb image load`, and booted the result. The remaining implementation decision is which small mise-enabled Linux builder image to publish or configure by default.

- **Q3: How should the wrapper handle the `.sandbox.toml` discovery boundary?** Walking up from `cwd` (like mise) is intuitive for monorepos and subdirectory usage. But a project might have its `.sandbox.toml` at the workspace root while the user operates from `src/` subdirectory. Does the wrapper warn if no `.sandbox.toml` is found in the current tree? Should it require `--project <name>` or `--config <path>` when not in a project directory? Decision: match mise's behavior — walk up, warn if not found, use personal defaults + built-in defaults as fallback.

- **Q4 (resolved): Should `install` support a second tool-specific home convention?** No. The requested and conventional destination is `~/.local/bin/mise-msb`; adding `$MISE_MSB_HOME` would introduce configuration without a concrete need. A future `--bin-dir` option can be added if users need another location.

- **Q5: What is the minimum Bun version?** The wrapper uses `Bun.spawn()`, `Bun.file()`, and the built-in TOML parser (`Bun.TOML.parse`). `Bun.TOML.parse` is available since Bun 1.0.0 but the TOML spec compliance improved in later releases. Minimum: Bun 1.2.0 (or the version currently in `mise.lock`). Document the minimum in the install check and the error message.
