## ADDED Requirements

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
