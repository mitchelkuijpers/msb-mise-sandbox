# layered-sandbox-config Specification (delta)

## ADDED Requirements

### Requirement: Signing configuration section

The layered schema SHALL accept an optional `[signing]` table with the
keys `enabled` (boolean, default `false`) and `key` (host path string,
supporting `~` expansion). The table SHALL merge across layers by the
standard scalar-replacement rule and MAY appear in any layer, including
the committed project `.sandbox.toml`. Strict schema validation SHALL
reject unknown keys inside `[signing]`, non-boolean `enabled` values,
and non-string or empty `key` values, with errors identifying the source
file and field path. When `enabled` is `false` or the table is absent,
the `key` field SHALL be ignored for validation of key-file properties
and no signing behavior SHALL activate.

#### Scenario: Personal layer supplies the key, project opts in
- **WHEN** the personal config sets `signing.key` and the project config sets `signing.enabled = true`
- **THEN** the merged configuration has signing enabled with the personal key path

#### Scenario: Project layer overrides key path
- **WHEN** both personal and project layers set `signing.key` and the project layer is higher precedence
- **THEN** the merged configuration uses the project key path, subject to key validation

#### Scenario: Unknown signing key rejected
- **WHEN** a config layer contains `signing.bits = 256`
- **THEN** validation fails naming the file and the unknown `signing.bits` field

#### Scenario: Disabled signing skips key-file validation
- **WHEN** `signing.enabled` is `false` or absent and `signing.key` names a nonexistent file
- **THEN** configuration loads successfully and no signing validation or argv emission occurs
