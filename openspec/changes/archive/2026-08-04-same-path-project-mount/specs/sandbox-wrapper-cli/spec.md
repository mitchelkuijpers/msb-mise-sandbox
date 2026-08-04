## ADDED Requirements

### Requirement: Same-path project mount drives create argv

Stock sandbox creation SHALL render the built-in `project` mount as `--mount-dir <projectRoot>:<projectRoot>:rw` and SHALL render `--workdir <projectRoot>` when no explicit workdir override applies, so the guest cwd and the project mount coincide at the host-absolute path. The project bootstrap stage SHALL invoke `mise-msb-bootstrap project <workdirTarget>` with the resolved workdir. Print mode SHALL show these rendered arguments, including the bootstrap stage argument, without executing anything.

#### Scenario: Default create argv mounts the project at its host path

- **WHEN** the merged config's project root is `/host/proj` and no explicit workdir or project target is configured
- **THEN** create argv contains `--mount-dir /host/proj:/host/proj:rw` and `--workdir /host/proj`, and contains no `/workspace`-based workdir

#### Scenario: Project bootstrap stage carries the resolved workdir

- **WHEN** stock create runs the project bootstrap stage for a config whose workdir target is `/host/proj`
- **THEN** the stage argv is `mise-msb-bootstrap project /host/proj`

#### Scenario: Print mode shows the same-path mount and workdir

- **WHEN** the user runs stock `create --print` for project root `/host/proj`
- **THEN** the printed sequence contains `--mount-dir /host/proj:/host/proj:rw`, `--workdir /host/proj`, and `mise-msb-bootstrap project /host/proj`, and no external command executes
