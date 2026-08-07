# stock-sandbox-image Specification

## Purpose
TBD - created by archiving change add-personalized-agent-runtime. Update Purpose after archive.
## Requirements
### Requirement: Explicit local stock image setup
The CLI SHALL provide `setup` to build a repository-owned Ubuntu stock Containerfile with host Docker, save the resulting image, and load it into microsandbox with `msb image load`. The stock image SHALL contain pinned mise, Docker CE, common tool-installation prerequisites, native Google Chrome for agent browser automation, and the versioned runtime helpers required by stock lifecycle bootstrap. Setup SHALL NOT publish the image or require a project-owned registry.

#### Scenario: First setup builds and loads the stock image
- **WHEN** the expected stock image generation is not loaded and the user runs `mise-msb setup`
- **THEN** the CLI builds the stock Containerfile, saves the image archive, loads the versioned local tag with `msb image load`, and reports that tag

#### Scenario: Stock image supports agent browser automation
- **WHEN** setup builds the stock image for amd64 or arm64
- **THEN** the image contains a native Google Chrome executable that browser-capable agents can use as a system browser

#### Scenario: Warm setup is a no-op
- **WHEN** the expected stock image generation is already loaded and the user runs `mise-msb setup`
- **THEN** the CLI exits successfully without rebuilding unless force mode was requested

#### Scenario: Setup does not publish externally
- **WHEN** setup succeeds
- **THEN** no registry login, push, temporary registry, or externally published image is used

### Requirement: Setup preflight and transparent failure
Before mutating local image state, setup SHALL verify required host commands and supported host architecture. It SHALL stream build, archive, and load output, propagate the first failing exit status, identify the failed stage, and preserve a failed-load archive for diagnostics. Setup SHALL support print mode that emits copyable commands without executing them.

#### Scenario: Docker is missing
- **WHEN** the user runs setup and the Docker CLI is unavailable
- **THEN** setup exits non-zero before building and reports Docker as the missing prerequisite

#### Scenario: Image load fails
- **WHEN** Docker build and save succeed but `msb image load` fails
- **THEN** setup exits non-zero, identifies image loading as the failed stage, and reports the preserved archive path

#### Scenario: Setup print mode is non-mutating
- **WHEN** the user runs `mise-msb setup --print`
- **THEN** the CLI prints the planned preflight, build, save, and load commands and executes none of them

### Requirement: Stock image is the default runtime
The merged runtime configuration SHALL default to stock image mode. Stock mode SHALL resolve to the wrapper's versioned local stock tag and SHALL enable wrapper-managed Docker and bootstrap behavior. Selecting custom image mode SHALL require an explicit image reference already available to microsandbox and SHALL disable stock-image compatibility guarantees.

#### Scenario: Unconfigured project uses stock image
- **WHEN** a project does not select an image mode
- **THEN** sandbox creation uses the expected versioned stock image tag

#### Scenario: Custom image mode remains available
- **WHEN** configuration explicitly selects custom image mode and reference `my-project:dev`
- **THEN** sandbox creation uses `my-project:dev` without building it and does not assume stock Docker or bootstrap helpers are present

#### Scenario: Missing stock image gives setup guidance
- **WHEN** stock mode is selected but the expected local stock image is absent
- **THEN** lifecycle creation fails before creating a sandbox and instructs the user to run `mise-msb setup`

### Requirement: User-local binaries are available in stock sandboxes
The stock image SHALL include `/root/.local/bin` on `PATH` for bootstrap stages and user commands. Mise-managed shims and binary directories SHALL precede `/root/.local/bin`, and system binary directories SHALL follow it.

#### Scenario: Personal bootstrap installs a user-local executable
- **WHEN** personal bootstrap installs an executable under `/root/.local/bin`
- **THEN** a later stock sandbox command resolves and executes it by name without an absolute path

#### Scenario: Mise-managed tools retain precedence
- **WHEN** an executable name exists in both a mise-managed path and `/root/.local/bin`
- **THEN** command lookup resolves the mise-managed executable first

### Requirement: Project bootstrap runs in the resolved workdir

The stock image SHALL NOT bake in a working directory; the wrapper always passes an explicit `--workdir` at creation, so the guest's default cwd is the same-path project mount target. The bundled `mise-msb-bootstrap` helper SHALL accept the workdir as its second argument (`mise-msb-bootstrap project <workdir>`, where the first argument is the subcommand) and SHALL run the project `mise trust`/`mise install` stages from that directory. When the argument is omitted, the helper SHALL use the current directory, which is the sandbox's configured workdir.

#### Scenario: Explicit workdir argument is honored

- **WHEN** stock lifecycle invokes `mise-msb-bootstrap project /host/proj`
- **THEN** the project bootstrap runs `mise trust` and `mise install` from `/host/proj`

#### Scenario: Omitted workdir defaults to the current directory

- **WHEN** `mise-msb-bootstrap project` is invoked without a workdir argument
- **THEN** the project bootstrap runs from the current directory, which is the sandbox's configured workdir

#### Scenario: Image carries no baked-in WORKDIR

- **WHEN** the stock image is built
- **THEN** the Containerfile contains no `WORKDIR` instruction and the image's default cwd is the image root

### Requirement: Stock image generation is versioned

The stock image generation SHALL be bumped whenever bundled runtime helper behavior or image content changes, so warm `mise-msb setup` rebuilds instead of silently reusing a stale image. The versioned tag SHALL follow the generation number.

#### Scenario: Content change invalidates warm setup

- **WHEN** the generation constant is bumped and the previous generation's image is loaded
- **THEN** `mise-msb setup` builds and loads the new generation's tag rather than skipping

### Requirement: Stock browser trusts runtime local certificate authorities
The stock lifecycle SHALL make runtime-provided local certificate authorities trusted by the stock image's native Google Chrome before project bootstrap or user commands execute. It SHALL preserve normal certificate verification rather than globally accepting invalid certificates, SHALL apply the trust initialization idempotently, and SHALL fail before project or user execution with actionable diagnostics when a provided local certificate authority cannot be applied. Custom images SHALL remain responsible for their own browser trust integration.

#### Scenario: Fresh stock browser navigates intercepted HTTPS
- **WHEN** a fresh stock sandbox receives a runtime local certificate authority and Chrome navigates to an allowed HTTPS destination whose certificate chains to that authority
- **THEN** Chrome validates the connection and renders the destination without disabling certificate verification

#### Scenario: Existing local browser trust is preserved
- **WHEN** trusted personal bootstrap has already established browser certificate state before stock browser trust initialization
- **THEN** the lifecycle adds or refreshes its owned local certificate entries without deleting unrelated browser trust entries

#### Scenario: Browser trust initialization is repeatable
- **WHEN** stock browser trust initialization runs again with unchanged local certificate authorities
- **THEN** it completes successfully without accumulating duplicate trust entries

#### Scenario: Runtime certificate authority rotates
- **WHEN** a runtime local certificate authority changes while retaining the same wrapper-owned identity
- **THEN** the next stock browser trust initialization replaces the stale browser trust entry with the current certificate

#### Scenario: No runtime local certificate authorities
- **WHEN** stock browser trust initialization finds no runtime-provided local certificate authorities
- **THEN** it completes successfully without weakening Chrome certificate verification

#### Scenario: Runtime certificate authority cannot be applied
- **WHEN** a runtime-provided local certificate authority cannot be added to Chrome's trust database
- **THEN** stock creation exits non-zero before project bootstrap or user commands and identifies browser trust initialization as the failed stage

#### Scenario: Custom image owns browser trust
- **WHEN** custom image mode is selected
- **THEN** the wrapper does not apply the stock browser trust initialization or guarantee Chrome compatibility

