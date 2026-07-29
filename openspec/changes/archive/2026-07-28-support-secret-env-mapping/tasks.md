## 1. Secret Mapping Contract

- [x] 1.1 Validate each named secret key as the guest environment variable while retaining independent validation of its `from` source.
- [x] 1.2 Add validation tests for valid guest/source mappings and invalid decorative secret keys with precise field paths.

## 2. Argument Generation

- [x] 2.1 Generate a literal `$MSB_<SOURCE_ENV>` guest `--env` bridge when a secret key differs from `from`, without resolving the host value.
- [x] 2.2 Preserve same-name secret behavior, deterministic argument ordering, allowed-host expansion, and authoritative secret mappings when ordinary environment entries overlap.
- [x] 2.3 Add focused argv and print-mode tests for differing names, same names, multiple hosts, environment overlap, and absence of real secret values.

## 3. Documentation and Verification

- [x] 3.1 Update usage and security documentation with a personal host source mapped to a conventional guest tool variable and explain the source placeholder visibility.
- [x] 3.2 Run the Bun test suite, TypeScript typecheck, diff checks, and OpenSpec validation for `support-secret-env-mapping`.
