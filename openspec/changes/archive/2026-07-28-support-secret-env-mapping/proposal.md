## Why

Named secret entries currently discard their table key when generating sandbox arguments, so a host-specific source such as `OPENCODE_API_KEY_PERSONAL` is exposed under that same name instead of the tool-facing `OPENCODE_API_KEY`. This contradicts the layered configuration model and prevents personal host naming conventions from being mapped cleanly to standard guest environment variables.

## What Changes

- Define the `[secrets.<name>]` table key as the guest-facing environment variable name.
- Keep `from` as the host environment variable used as the secret value source.
- When the guest and source names differ, bridge the guest variable to microsandbox's source placeholder without resolving or exposing the real value.
- Preserve the current source-based `--secret SOURCE_ENV@HOST` arguments and allowed-host restrictions.
- Validate guest-facing secret names as environment variable identifiers, as already required by the strict schema contract.
- Document examples where personal host variables map to conventional tool variables.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `layered-sandbox-config`: Define the named secret key as the guest environment variable and distinguish it from the host source.
- `sandbox-wrapper-cli`: Generate a placeholder environment bridge when guest and source secret names differ while retaining secret-safe printed output.

## Impact

- Affects secret validation, create-argument generation, tests, and secret configuration documentation.
- Existing configurations where the secret name equals `from` retain their current behavior.
- Configurations using decorative or non-environment-compatible secret table keys will be rejected and must rename the key to the intended guest variable.
- No new dependency or secret-value handling is introduced; real values remain in the inherited host environment and microsandbox TLS substitution boundary.
