## Why

The microsandbox runtime natively supports publishing host ports into a guest microVM (TS SDK `.port()` / `.portBind()` / `.portUdp()` / `.portUdpBind()`; CLI `-p HOST:GUEST`), but `agent-sandbox` never wires this through. The `ProjectConfig` schema has no `ports` field, `createSandbox()` never calls the port builder methods, and the `project add` wizard never prompts for ports. Agents that need to expose a dev server (e.g. a web app on 8080) to the host currently have no path to do so through the project registry.

This is a config-layer gap, not a runtime limitation — all four builder methods are available in the pinned `microsandbox@0.6.6` SDK (`node_modules/microsandbox/dist/internal/napi.d.ts:131-134`).

## What Changes

- Add a `ports?: PortSpec[]` field to `ProjectConfig` in `src/types.ts`, with a `PortSpec` interface (`hostPort`, optional `guestPort`, optional `protocol`, optional `bind`). Default `[]`. `applyDefaults` fills the top-level array; per-entry defaults resolve at the builder call site (mirroring how `network.allow` is parsed late in `src/lib/sandbox.ts`).
- Add a `parsePortSpec(spec)` validator in `src/lib/network.ts` (alongside `parseAllowRule`): validates integer ports 1-65535, protocol in `tcp|udp`, resolves `guestPort` defaulting to `hostPort`, and `bind` defaulting to `127.0.0.1` (loopback-only — the security default).
- Wire ports in `createSandbox()` (`src/lib/sandbox.ts`): loop over `cfg.ports`, call `sb.port` / `sb.portBind` / `sb.portUdp` / `sb.portUdpBind` based on protocol and whether bind is loopback or custom.
- Add unit tests for `parsePortSpec` in `tests/network.test.ts` and for port wiring in `tests/sandbox.test.ts` (extend the mock builder with port-method recorders).

## Capabilities

### Modified Capabilities

- `sandbox-network`: add requirements for published host→guest port forwarding with loopback-by-default binding, per-entry validation, and structured config entries.

### New Capabilities

None.

## Impact

- **Modified**: `src/types.ts` (new `PortSpec` type + `ports` field + defaults), `src/lib/network.ts` (new `parsePortSpec`), `src/lib/sandbox.ts` (port-wiring loop), `tests/network.test.ts`, `tests/sandbox.test.ts`.
- **New**: None.
- **Dependencies**: No new dependencies — uses existing `microsandbox@0.6.6` builder methods already in the SDK.
- **Risk**: Low. Port publishing is an additive, opt-in feature. Projects without `ports` see no behavior change. The loopback default keeps the security posture aligned with the project's deny-by-default egress and scoped-secrets model.

## Non-Goals

- `project add` wizard prompt for ports (deferred to a follow-up if desired).
- Any `--replace` / auto-recreate flow when `ports` change after creation. Changing ports requires `agent-sandbox remove` + `create` (same as changing `resources` or `image` today) — documented as a caveat.
- Egress/ingress interaction spike — published ports are runtime-managed ingress independent of the egress `NetworkPolicy`; left as a follow-up note.
