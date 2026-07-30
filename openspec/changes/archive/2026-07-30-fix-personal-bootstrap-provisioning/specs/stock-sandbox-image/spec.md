## ADDED Requirements

### Requirement: User-local binaries are available in stock sandboxes
The stock image SHALL include `/root/.local/bin` on `PATH` for bootstrap stages and user commands. Mise-managed shims and binary directories SHALL precede `/root/.local/bin`, and system binary directories SHALL follow it.

#### Scenario: Personal bootstrap installs a user-local executable
- **WHEN** personal bootstrap installs an executable under `/root/.local/bin`
- **THEN** a later stock sandbox command resolves and executes it by name without an absolute path

#### Scenario: Mise-managed tools retain precedence
- **WHEN** an executable name exists in both a mise-managed path and `/root/.local/bin`
- **THEN** command lookup resolves the mise-managed executable first
