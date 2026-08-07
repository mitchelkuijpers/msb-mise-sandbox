## MODIFIED Requirements

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
