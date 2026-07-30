## Context

`mise-msb` currently exposes setup and provisioning commands alongside thin wrappers for `msb` runtime lifecycle, connection, execution, teardown, and listing operations. The CLI dispatcher is the only public command registry; the generated `msb` argv helpers remain shared implementation primitives for setup and provisioning.

## Goals / Non-Goals

**Goals:**

- Make the supported CLI surface explicit: `setup`, `create`, `config`, `signing init`, and `install`.
- Remove the user-selected runtime wrappers and their aliases from dispatch and help.
- Preserve setup and provisioning behavior, including configuration-derived `msb create` argv generation and stock bootstrap.

**Non-Goals:**

- Changing `msb` behavior or the sandbox runtime, bootstrap stages, connection semantics, or in-sandbox execution implementation.
- Removing `install`, changing configuration schema, or adding replacement wrapper commands.

## Decisions

- Remove commands at the dispatcher boundary rather than redirecting them to `msb`. This gives the wrapper a clean, smaller contract and avoids maintaining aliases for capabilities that belong to `msb`.
- Remove the selected command entry modules when they have no remaining callers; retain shared `msb` lifecycle helpers because setup/provisioning code and existing lower-level tests may still consume them. This avoids altering runtime behavior outside the CLI scope.
- Treat `create` as provisioning rather than runtime control. It remains responsible for applying the declared sandbox configuration and required stock initialization.

## Risks / Trade-offs

- Existing scripts that invoke removed commands will fail with the normal unknown-command error. The migration path is direct `msb` invocation.
- Internal lifecycle helpers may remain although their public CLI routes disappear. This is deliberate: deleting runtime behavior is outside this change and could affect lower-level consumers.
