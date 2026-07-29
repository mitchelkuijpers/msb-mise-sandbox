## MODIFIED Requirements

### Requirement: Secret configuration contains references only

Each named secret key SHALL be a valid guest environment variable name and SHALL contain a source host environment variable name plus one or more allowed hosts, but SHALL NOT contain a value. The wrapper SHALL verify that each referenced source variable is present without reading or printing its value. It SHALL generate source-based `msb --secret SOURCE_ENV@HOST` arguments and, when the guest name differs from the source name, SHALL map the guest variable to the literal `$MSB_<SOURCE_ENV>` placeholder. The wrapper SHALL never place a real secret value in configuration, wrapper state, logs, or argv.

#### Scenario: Present source generates source-based arguments
- **WHEN** `secrets.OPENAI_API_KEY.from = "OPENAI_API_KEY"`, its allowlist contains `api.openai.com`, and that host variable is present
- **THEN** the wrapper generates `--secret OPENAI_API_KEY@api.openai.com` without resolving the value and does not require a separate guest bridge

#### Scenario: Missing source fails before creation
- **WHEN** a configured secret references an unset host environment variable
- **THEN** the CLI names the missing variable, exits non-zero, and creates no sandbox resource

#### Scenario: Different guest and source names are mapped
- **WHEN** `secrets.OPENCODE_API_KEY.from = "OPENCODE_API_KEY_PERSONAL"` and its allowlist contains `opencode.ai`
- **THEN** the guest receives `OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL` while the wrapper emits `--secret OPENCODE_API_KEY_PERSONAL@opencode.ai` without resolving the host value

#### Scenario: Invalid guest secret name is rejected
- **WHEN** a secret table key is not a valid environment variable identifier
- **THEN** validation identifies that secret key, exits non-zero, and executes no external command
