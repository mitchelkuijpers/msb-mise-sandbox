## 1. Builder And CLI Foundations

- [x] 1.1 Select and verify a small Linux builder image containing a pinned mise version with experimental OCI support
- [x] 1.2 Create the `mise-msb` Bun entry point and minimal command dispatcher without adding a CLI framework
- [x] 1.3 Add subprocess helpers that use argv arrays, inherit terminal streams, propagate exit codes, and support print-only execution
- [x] 1.4 Add shell-safe command formatting for copyable `--print` output without resolving secret values

## 2. Layered Configuration

- [x] 2.1 Define strict TypeScript types and built-in defaults for build, runtime, environment, secrets, mounts, ports, network, and commands
- [x] 2.2 Implement TOML loading with explicit config selection, parent-directory project discovery, and optional personal defaults
- [x] 2.3 Implement deterministic scalar, recursive-table, named-entry, command-array, and network-inheritance merge rules
- [x] 2.4 Implement strict unknown-key and field validation with source-file and field-path diagnostics
- [x] 2.5 Implement normalized project-name and image-tag derivation from the discovered project root
- [x] 2.6 Implement secret-source presence checks that never read, copy, log, or place secret values in argv
- [x] 2.7 Add a `config` command that prints the effective merged configuration without secret values

## 3. Microsandbox Command Translation

- [x] 3.1 Generate deterministic `msb create` argv with positional image, name, resources, workdir, labels, and environment flags
- [x] 3.2 Translate named directory, file, disk, and named-volume mounts to their explicit canonical `msb` mount flags
- [x] 3.3 Translate named TCP and UDP ports to supported `msb --port` syntax with loopback binding by default
- [x] 3.4 Translate default egress, allow rules, and secret hosts to deduplicated `--net-default`, `--net-rule`, and source-based `--secret` arguments
- [x] 3.5 Implement lifecycle delegation for create, start, stop, remove, list, shell, and exec using canonical `msb` command names
- [x] 3.6 Implement `run` state handling for absent, stopped, and already-running named sandboxes before attaching the configured or supplied command
- [x] 3.7 Support `--print` and `--dry-run` across single-step and multi-step lifecycle commands with successful no-execution behavior

## 4. Mise OCI Image Workflow

- [x] 4.1 Implement direct Linux `mise oci build` execution with configured base, tag, and temporary output layout
- [x] 4.2 Implement macOS Linux builds through `msb run` with a read-only project mount and read-write output mount
- [x] 4.3 Archive the generated OCI Image Layout with host `tar` and import it using `msb image load --input ... --tag ...`
- [x] 4.4 Implement temporary-output cleanup on success and artifact preservation with an actionable path on archive or import failure
- [x] 4.5 Stream each build stage's output, identify the failed stage, and propagate its exit status
- [ ] 4.6 Verify a built image boots through `msb run` and executes representative mise-installed Linux tools

## 5. Local Installation

- [x] 5.1 Add an executable repository launcher suitable as the stable symlink target
- [x] 5.2 Implement idempotent `install [--force]` behavior for `~/.local/bin/mise-msb`, including safe collision handling
- [x] 5.3 Add the non-invasive PATH warning without modifying shell startup files
- [x] 5.4 Add a repository `mise run install` task that delegates to the wrapper install command

## 6. Tests

- [x] 6.1 Add unit tests for config discovery, precedence, named-table merging, network inheritance reset, and deterministic ordering
- [x] 6.2 Add validation tests for malformed TOML, unknown keys, invalid resources, mounts, ports, network rules, and secret references
- [x] 6.3 Add argv snapshot tests covering creation, mounts, ports, deny-by-default networking, secret scoping, and shell metacharacters
- [x] 6.4 Add lifecycle tests with a fake `msb` executable for state transitions, argument passthrough, exit propagation, and print mode
- [x] 6.5 Add build-pipeline tests with fake `mise`, `tar`, and `msb` executables for Linux, macOS-builder, import, cleanup, and failure paths
- [x] 6.6 Add isolated filesystem tests for first install, idempotent reinstall, collision refusal, force replacement, directory refusal, and PATH warning

## 7. Migration And Documentation

- [x] 7.1 Remove the microsandbox SDK and unused CLI dependencies after the replacement command paths are covered by tests
- [x] 7.2 Remove the central registry, interactive project commands, agent-specific launch commands, and Docker-specific orchestration code
- [x] 7.3 Replace the current image documentation with the mise OCI build flow, Linux/macOS behavior, and builder image requirements
- [x] 7.4 Document the personal and project TOML schemas, precedence, merge rules, network security model, and committed secret-reference pattern
- [x] 7.5 Document migration examples from `projects.json` and Docker-specific settings to `.sandbox.toml`, mise image composition, and generic mounts
- [x] 7.6 Update the README quick start around `mise run install`, `mise-msb build`, `mise-msb run`, and transparent print mode
- [x] 7.7 Run `bun test`, type checking, OpenSpec validation, and an end-to-end local build/load/run smoke test
