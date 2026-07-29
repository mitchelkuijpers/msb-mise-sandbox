## Context

Secret configuration is represented as `Record<guestName, { from, hosts }>`, but create-argument generation currently uses only `from`. For `secrets.OPENCODE_API_KEY.from = "OPENCODE_API_KEY_PERSONAL"`, the wrapper emits `--secret OPENCODE_API_KEY_PERSONAL@HOST`; microsandbox then exposes the source-named placeholder in the guest. The intended guest name is discarded.

The wrapper must preserve its references-only security model: it may check whether the source variable exists, but it must not resolve, copy, log, or place the real value in argv. Microsandbox's source-based CLI syntax does not directly rename the source variable, but its TLS proxy substitutes the literal `$MSB_<SOURCE_ENV>` placeholder wherever an allowed request uses it.

## Goals / Non-Goals

**Goals:**

- Make the secret table key the stable guest-facing environment variable contract.
- Allow a host source name to differ from the variable expected by a guest tool.
- Preserve source-based secret arguments, host allowlists, deterministic argv, and references-only handling.
- Keep existing same-name configurations behaviorally unchanged.
- Make generated and printed commands sufficient to diagnose the mapping without revealing values.

**Non-Goals:**

- Removing microsandbox's source-named placeholder from the guest environment.
- Reading or copying secret values to construct a renamed source environment.
- Changing TLS substitution, host allowlist, network policy, or secret rotation behavior.
- Supporting arbitrary decorative names for `[secrets.<name>]`; the name is an environment variable identifier.

## Decisions

### Use the table key as the guest name

For `[secrets.OPENCODE_API_KEY]`, `OPENCODE_API_KEY` is the variable consumed by guest tools and `from` identifies only the host source. This gives both existing fields distinct, useful semantics and matches the existing typed record shape and strict-schema language.

Using a new `target` field was considered, but it would add a third name while leaving the table key semantically empty. Treating `from` as both source and target preserves current behavior but cannot satisfy personal-to-conventional mappings.

### Bridge differing names with a literal microsandbox placeholder

When guest and source names differ, create argv will contain both:

```text
--env OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL
--secret OPENCODE_API_KEY_PERSONAL@opencode.ai
```

The `--env` value is a literal placeholder, not the secret. A tool reads `OPENCODE_API_KEY`, sends that placeholder to an allowed TLS destination, and microsandbox substitutes the host value at the network boundary. When names match, no bridge is needed because `--secret` already exposes the expected source-named placeholder.

Passing `GUEST=$SOURCE@HOST` as a secret argument was considered, but the wrapper's supported microsandbox CLI contract is source-based `SOURCE@HOST`. Resolving the source into a child-process environment under the guest name was rejected because it would copy the real value through wrapper state and weaken the current security boundary.

### Preserve deterministic ordering and secret-safe output

Derived bridge entries will be generated from sorted secret names alongside the existing sorted environment and secret arguments. Print mode will show the literal placeholder and source/host reference, making the mapping observable without exposing the value.

### Validate the guest name

Secret table keys will be validated with the existing environment-name rule. This enforces the already documented strict-schema contract and prevents generating invalid `--env` entries. The `from` field remains independently validated because both sides of the mapping must be legal environment names.

## Risks / Trade-offs

- [The source-named placeholder remains visible in the guest in addition to the guest alias] -> Document that both contain placeholders only and define the table key as the variable tools should consume.
- [A configured non-environment secret key begins failing validation] -> Return the exact `secrets.<name>` field path and document renaming the key to the intended guest variable.
- [A placeholder bridge could be mistaken for a real secret in diagnostics] -> Keep documentation explicit that `$MSB_<SOURCE>` is a literal token substituted only at the allowed TLS boundary.
- [Duplicate guest names could conflict with ordinary `[env]` entries] -> Treat the secret mapping as authoritative during argument generation and cover precedence with focused tests; no real secret value enters either path.

## Migration Plan

1. Existing same-name entries require no changes.
2. Rename decorative table keys to the guest variable expected by the tool while retaining the personal host variable in `from`.
3. Recreate existing sandboxes so their creation environment includes the bridge.
4. Rollback restores source-only exposure; configurations whose guest name differs can temporarily use the source variable directly.

## Open Questions

None.
