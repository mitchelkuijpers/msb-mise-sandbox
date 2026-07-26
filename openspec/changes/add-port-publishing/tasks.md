## 1. Config Schema

- [ ] 1.1 Add `PortSpec` interface to `src/types.ts` (`hostPort: number`, `guestPort?: number`, `protocol?: "tcp" | "udp"`, `bind?: string`)
- [ ] 1.2 Add `ports?: PortSpec[]` field to `ProjectConfig`, `DEFAULTS.ports = []`, and `ports: config.ports ?? []` in `applyDefaults`
- [ ] 1.3 Verify `bun tsc --noEmit` (or equivalent typecheck) passes with the new types

## 2. Port Spec Parser

- [ ] 2.1 Add `parsePortSpec(spec: PortSpec)` to `src/lib/network.ts` returning a normalized `{ hostPort, guestPort, protocol, bind }` with validation: integer ports 1-65535, protocol in `tcp|udp`, `guestPort` defaults to `hostPort`, `bind` defaults to `127.0.0.1`
- [ ] 2.2 Add unit tests for `parsePortSpec` in `tests/network.test.ts`: defaults (guest=host, tcp, 127.0.0.1), explicit udp, explicit bind `0.0.0.0`, invalid port (0, 65536, non-integer), invalid protocol, missing hostPort
- [ ] 2.3 Run `bun test tests/network.test.ts` and confirm all pass

## 3. Sandbox Wiring

- [ ] 3.1 In `src/lib/sandbox.ts` `createSandbox()`, after the env loop and before `sb.network(...)`, loop over `cfg.ports`: parse each with `parsePortSpec`, then call `sb.port` / `sb.portBind` / `sb.portUdp` / `sb.portUdpBind` based on protocol and bind value
- [ ] 3.2 Extend the mock builder in `tests/sandbox.test.ts` with `port`, `portBind`, `portUdp`, `portUdpBind` recorder methods (same shape as existing `cpus`/`memory`/`env`)
- [ ] 3.3 Add a `createSandbox ports` describe block in `tests/sandbox.test.ts` asserting the correct builder method and args are called for: default tcp/loopback, explicit bind tcp, udp/loopback, udp/explicit bind, and empty `ports` (no port calls)
- [ ] 3.4 Run `bun test tests/sandbox.test.ts` and confirm all pass

## 4. Lint and Typecheck

- [ ] 4.1 Run `bun tsc --noEmit` (or the repo's typecheck command) and confirm no errors
- [ ] 4.2 Run the full test suite `bun test` and confirm no regressions
