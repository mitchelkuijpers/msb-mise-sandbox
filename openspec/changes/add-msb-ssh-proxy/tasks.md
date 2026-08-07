## 1. SSH Proxy Command

- [x] 1.1 Add alias parsing that accepts exactly one valid `<sandbox>.msb` value, strips the suffix once, validates the remaining microsandbox name, and rejects invalid input before spawning a process
- [x] 1.2 Implement the transport-only proxy execution as canonical argv `msb ssh serve <name> --stdio` with inherited stdin/stdout/stderr and exact launch/exit propagation
- [x] 1.3 Register `ssh-proxy` in the dispatcher and usage output without adding any general lifecycle command
- [x] 1.4 Add focused tests for exact argv, raw-msb name routing without config discovery, invalid argument rejection, byte-transparent streams, clean stdout, and child failure propagation

## 2. Reusable SSH Configuration

- [x] 2.1 Implement `ssh-config` as a deterministic renderer for the scoped `Host *.msb` block, with no filesystem access or subprocess invocation
- [x] 2.2 Register `ssh-config` in the dispatcher and reject positional arguments with actionable usage guidance
- [x] 2.3 Add focused tests for exact configuration output, `.msb` scoping, required proxy and host-key options, argument rejection, and absence of side effects

## 3. Post-Create Guidance

- [x] 3.1 Print the `<name>.msb`, `~/.ssh/config`, and `mise-msb ssh-config` hint only after sandbox creation and all applicable bootstrap stages succeed
- [x] 3.2 Add tests proving successful creation prints the hint while failed creation, failed bootstrap, and `create --print` do not claim Remote SSH readiness

## 4. User and Security Documentation

- [x] 4.1 Update the README and usage guide with one-time wildcard setup, `ssh <name>.msb`, VS Code Remote-SSH selection, SSH authorization prerequisite, and `ssh -G <name>.msb` troubleshooting
- [x] 4.2 Update the security guide to explain that host authentication is disabled only for the direct local stdio bridge and warn against copying the options into `Host *`

## 5. Verification

- [x] 5.1 Run the focused command, dispatch, proxy transport, configuration rendering, and create-output tests
- [x] 5.2 Run `bun test` and `bun run typecheck`
- [x] 5.3 Smoke-test `mise-msb ssh-config` through `ssh -G`, then exercise `ssh-proxy` against a controlled fake `msb` transport to verify stdin/stdout bytes and exit status end to end
- [x] 5.4 Run strict OpenSpec validation for `add-msb-ssh-proxy` and resolve every proposal, design, spec, and task consistency error
