## ADDED Requirements

### Requirement: Built-in same-path project mount

The layered schema SHALL include a built-in `project` mount with kind `dir`, source `"."`, options `"rw"`, and a target that defaults to the resolved source. At merge time, any mount whose `source` is exactly `"."` SHALL resolve to the project root (the directory containing the discovered `.sandbox.toml`, or the cwd fallback), and the merged configuration SHALL carry the absolute path. The effective `project` mount target SHALL drive the sandbox workdir unless a layer sets an explicit `workdir` key, in which case the explicit workdir SHALL win. A layer-supplied `[mounts.project]` entry SHALL merge by name per normal named-table rules; an explicit `target` SHALL override the same-path default and the workdir SHALL follow the effective target.

#### Scenario: Default config mounts the project at its host path

- **WHEN** the project root is `/host/proj` and no layer configures `project` or `workdir`
- **THEN** the merged configuration contains `mounts.project` with source `/host/proj`, target `/host/proj`, and options `"rw"`, and the workdir is `/host/proj`

#### Scenario: Source dot resolves at merge time

- **WHEN** a layer declares `mounts.workspace = { kind = "dir", source = ".", target = "/workspace" }` and the project root is `/host/proj`
- **THEN** the merged entry has source `/host/proj` and target `/workspace`

#### Scenario: Explicit project target overrides the default and moves the workdir

- **WHEN** a layer declares `[mounts.project] target = "/custom"` and the project root is `/host/proj`
- **THEN** the merged project mount has source `/host/proj`, target `/custom`, and the workdir is `/custom`

#### Scenario: Explicit workdir key wins over the project mount

- **WHEN** a layer declares `workdir = "/elsewhere"` and no layer sets an explicit project target
- **THEN** the workdir is `/elsewhere` while the project mount stays at the resolved same-path target

#### Scenario: Dot source without a project root stays verbatim

- **WHEN** configuration is merged without a project root and a layer declares `source = "."`
- **THEN** the source remains `"."` and the workdir keeps its built-in default
