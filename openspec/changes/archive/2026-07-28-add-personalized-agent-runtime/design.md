## Context

The wrapper currently assumes every project first builds a `<project>:dev` image with experimental `mise oci`. On macOS that requires a Linux builder microVM; a personal Containerfile adds Docker build/save, an in-VM registry, skopeo transport, and a handoff script before the project image can be loaded. Afterward, Docker inside the sandbox is still a project-owned concern requiring a compatible image, daemon startup, and a disk-backed `/var/lib/docker` mount.

The desired normal workflow is different: developers will explicitly build one local Ubuntu stock image, use it across projects, keep Docker always available, and install changing project and personal tools at runtime into persistent per-project mise storage. Each developer also needs one trusted personal bootstrap that can install tools and packages, manage dotfiles, execute hooks, and expose explicit host-side configuration without committing those choices to project repositories.

The existing deterministic config merge, secret-reference model, generic mounts, lifecycle state planner, print mode, and direct Docker build/save plus `msb image load` helpers remain useful. The design must not publish a project-owned image, read secret values, implicitly mount host credentials, or silently execute project-owned bootstrap as personal trusted code.

## Goals / Non-Goals

**Goals:**

- Make a versioned, locally built Ubuntu stock image the default runtime.
- Make normal project startup independent of a project-specific image build.
- Provide working, persistent Docker by default in stock-image sandboxes.
- Cache mise-installed personal and project tools in an isolated per-project named volume.
- Support one full, user-owned personal bootstrap and automatically apply changes to it.
- Merge personal mise tools as global configuration with the project's normal mise hierarchy.
- Preserve transparent, deterministic command planning and explicit cleanup information.
- Allow explicitly selected custom image references without building them in the wrapper.

**Non-Goals:**

- Publishing or operating a stock-image registry.
- Sharing mise or Docker data volumes between projects or hosts.
- Adding tool-specific wrapper commands or setup behavior.
- Automatically discovering or mounting host credentials.
- Building, publishing, or guaranteeing Docker/bootstrap helpers in custom images.
- Making cold setup or cold tool installation work offline.
- Automatically deleting persistent state when a sandbox is removed.

## Decisions

### 1. Split stable image capabilities from changing developer state

The runtime has three inputs with different lifecycles:

```text
repository stock Containerfile -> local versioned stock image
personal bootstrap             -> trusted developer provisioning
project mise.toml              -> project tools and tasks
```

The stock image contains Ubuntu, a pinned mise binary, Docker CE, common installation prerequisites, and versioned helper programs. It does not contain project tools, personal dotfiles, personal configuration, or credentials. Personal and project tools install under a named `/mise` volume at runtime.

This avoids rebuilding the base when `mise.toml` or personal preferences change. Users who need an immutable custom image build and load it with external tooling, then select its reference explicitly; the wrapper does not maintain a second image-build architecture.

Alternatives considered:

- Keep per-project `mise oci` images. This retains the experimental, architecture-sensitive build pipeline and most of the complexity that prompted the change, even if made optional.
- Use upstream `docker:dind` directly. This removes local setup but introduces Alpine/musl compatibility constraints for arbitrary mise tools.
- Publish a project-owned stock image. This gives the easiest cold start but was explicitly rejected as an operational dependency.

### 2. Build and load the stock image with direct, stable tools

`mise-msb setup` builds a repository-owned Containerfile with host Docker, saves the image as an archive, and loads it with `msb image load`. The tag contains a stock-image generation controlled by the wrapper, for example `mise-msb-base:v1`. Setup checks prerequisites before mutation, streams output, skips an already loaded matching generation, and supports print mode and an explicit force rebuild.

The repository no longer invokes `mise oci`, starts a builder microVM, runs a temporary registry, or uses skopeo. Apple Silicon Docker builds a Linux ARM64 stock image matching the microsandbox host; Linux builds for its native architecture.

### 3. Select stock versus externally managed custom images explicitly

The merged schema gains an image mode with `stock` as the default and `custom` as the advanced value. Stock mode resolves to the wrapper's versioned local stock tag and enables wrapper-managed Docker and bootstrap. Custom mode requires an explicit image reference that the user has already made available to microsandbox and retains generic lifecycle behavior; the selected image is responsible for its tools, services, and compatibility.

This explicit distinction is preferable to inferring behavior from a tag string. The existing `[build]` section and `mise-msb build` command are removed rather than retained as a parallel architecture. Custom-image creation, publishing, and loading stay outside the wrapper.

### 4. Derive isolated persistent volumes from sandbox identity

Stock mode injects two mounts after merged config validation:

```text
<sandbox>-mise-v1:/mise:kind=dir
<sandbox>-docker-data:/var/lib/docker:kind=disk,size=<configured size>
```

The Docker disk defaults to 10G and personal or project config can change its size through a typed stock-runtime setting. The directory-backed mise volume has no wrapper-imposed quota and uses available host storage. Project config cannot substitute arbitrary host sources for the derived state mounts. A conflicting explicit mount target fails before `msb` execution with an actionable message.

The mise volume generation changes only for incompatible stock ABI or directory-layout changes. The Docker volume is not stock-generation-qualified so normal stock image upgrades preserve pulled images and build cache; Docker major versions remain pinned to a compatible upgrade path.

Directory-backed mise volumes permit concurrent attachment but remain per-project to avoid install-option conflicts and cross-project state leakage. Disk-backed Docker volumes have a single writable attachment, matching one running sandbox per identity.

### 5. Use stock-image helpers for idempotent lifecycle bootstrap

The stock image provides argv-driven helpers rather than asking the TypeScript wrapper to interpolate shell snippets:

- `docker-up` starts dockerd if needed, waits for readiness, and reports daemon diagnostics on failure.
- `mise-msb-bootstrap personal <hash>` runs personal provisioning only when the sandbox-local marker differs.
- `mise-msb-bootstrap project` trusts the selected workspace configuration and installs project tools, using `--locked` exactly when `mise.lock` exists.

After `msb create` or `msb start`, stock lifecycle plans invoke Docker readiness and personal bootstrap before project bootstrap and the requested command. `run`, `shell`, and `exec` ensure project tools before user execution so a changed `mise.toml` is observed without image rebuild. The warm path relies on mise's own installed-tool checks and cache.

The personal marker lives in the sandbox writable root, not the persistent mise volume. Removing and recreating a sandbox therefore reruns packages, dotfiles, and hooks even when cached tools survive. Stop/start retains the marker but still reruns the idempotent Docker readiness step. Personal hooks are documented as trusted code that must tolerate re-execution after their input changes.

### 6. Treat one personal mise file as global config

The wrapper conventionally discovers `~/.config/mise-msb/bootstrap/mise.toml` using the same XDG-aware base directory as personal config. If present, its directory is mounted read-only at `/etc/mise-msb/personal`, and stock lifecycle commands set:

```text
MISE_GLOBAL_CONFIG_FILE=/etc/mise-msb/personal/mise.toml
```

Personal full bootstrap runs from a neutral directory outside `/workspace`, so only the user-owned global config contributes packages, dotfiles, repositories, and hooks. Project installation then runs from `/workspace`, where mise naturally merges the personal global tools with project configuration and gives the project its normal higher precedence.

The wrapper hashes the complete personal bootstrap directory deterministically, including relative paths and file contents, so changes to supporting files trigger provisioning. A missing personal bootstrap is valid and omits its mount and personal stage.

### 7. Keep host configuration explicit and separate from secrets

Developers continue to declare host files and directories as named mounts in personal `config.toml`. No credential or tool configuration path is auto-discovered. Read-only is recommended for static configuration; writable mounts are allowed when tools must refresh local state.

Host-mounted credential files are visible to all guest code and writable mounts can modify host state. The config validator and documentation therefore identify host mounts as trusted personal configuration, warn for broad home/config mounts, and show narrowly scoped examples. API keys remain references-only microsandbox secrets whenever the destination protocol supports placeholder substitution.

Personal tools run through the existing generic `run`, `shell`, and `exec` commands. Personal mise configuration owns tool selection and versioning.

### 8. Preserve state by default and make cleanup visible

`remove` deletes the sandbox but not named volumes. For stock mode it prints both preserved names and copyable `msb volume remove` commands. Automatic volume deletion and a future explicit purge option are deferred to avoid accidental loss of Docker images, OAuth state, or installed tools.

### 9. Keep every generated stage printable and secret-safe

Lifecycle planning represents setup and bootstrap as explicit argv groups. `--print` displays stock setup, create/start, Docker readiness, personal bootstrap, project bootstrap, and final exec in order without executing commands. Personal bootstrap hashes and secret source names are printable; secret values remain unread by the wrapper.

## Risks / Trade-offs

- [Cold setup still requires host Docker and network access] -> Make setup explicit, preflight all commands, pin the stock generation, stream progress, and skip warm setup.
- [Runtime provisioning is less immutable than a prebuilt image] -> Use `mise install --locked` when a lockfile exists, isolate state by project, and allow externally built custom image references when immutability is required.
- [Full personal bootstrap runs arbitrary operator code as root in the VM] -> Load it only from the user's config directory, mount it read-only, run it separately from project config, and document the trust boundary.
- [Host configuration mounts expose credentials to project code] -> Never add implicit mounts, recommend narrow read-only paths, warn on broad or writable sensitive paths, and prefer scoped secret substitution when possible.
- [Persistent caches can become stale or consume host disk] -> Version incompatible mise layouts, print cleanup commands, and document `msb volume inspect/remove` operations; do not add a mise-specific quota setting.
- [Docker startup adds latency to every stock sandbox] -> Use an idempotent readiness helper; always-on Docker is an explicit product choice for the stock runtime.
- [Custom images lose stock conveniences] -> Require explicit custom image mode and clearly state that custom images own Docker and bootstrap compatibility.
- [Removing the existing build command disrupts current users] -> Provide a clear migration to stock mode or externally built/loaded custom images and preserve no ambiguous partial compatibility.

## Migration Plan

1. Add the stock Containerfile, helpers, setup planner, and local image tag without changing lifecycle defaults.
2. Add image mode and Docker data-size settings to config, with `stock` as the new default and `custom` plus an explicit image reference for externally managed images.
3. Add derived volumes and stock bootstrap stages behind stock mode, then validate Docker, mise cold/warm behavior, stop/start, and removal persistence.
4. Add personal bootstrap discovery, deterministic hashing, global mise config wiring, and host-mount security documentation.
5. Switch docs and examples from `build`-before-create to `setup`-once plus runtime provisioning.
6. Remove the `build` command, `[build]` schema, mise OCI modules, personal Containerfile discovery, builder image, registry/skopeo handoff, and obsolete tests/docs after moving reusable direct Docker build/save/load behavior into stock setup.

Rollback consists of selecting custom image mode and referencing an image built and loaded with external tooling. Persistent named volumes remain intact and can be reused or removed manually.

## Open Questions

- Whether a future `remove --volumes` or dedicated `purge` command should remove both derived volumes remains intentionally deferred.
- Whether stock-image updates should later be distributed as release archives can be revisited without changing the runtime/bootstrap contract.
