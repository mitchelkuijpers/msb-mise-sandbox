## Context

`agent-sandbox` wraps the microsandbox TS SDK. `createSandbox()` in `src/lib/sandbox.ts` builds a `Sandbox` via `Sandbox.builder(name)`, chaining `.image()`, `.cpus()`, `.memory()`, `.volume()`, `.env()`, and `.network(...)`. It never calls the port-publishing methods that the SDK exposes:

- `port(host, guest)` — TCP, binds 127.0.0.1
- `portBind(bind, host, guest)` — TCP, custom bind address
- `portUdp(host, guest)` — UDP, binds 127.0.0.1
- `portUdpBind(bind, host, guest)` — UDP, custom bind address

(Confirmed in `node_modules/microsandbox/dist/internal/napi.d.ts:131-134`; the SDK reference example at `.agents/skills/microsandbox/references/sdk-typescript.md:70` shows `.port(8000, 8000)` chained on the builder.)

The `ProjectConfig` schema (`src/types.ts`) has no `ports` field. The existing `network` field covers egress allow rules; ingress port publishing is a distinct concern with its own validation and security defaults.

## Goals / Non-Goals

**Goals:**
- Let a project publish host ports that forward into the sandbox microVM, via structured config entries in `projects.json`.
- Default to loopback-only binding so published ports are reachable from the host but not exposed to the LAN, keeping the security stance aligned with the project's deny-by-default egress and scoped-secrets model.
- Validate port specs at parse time with clear errors, mirroring the existing `parseAllowRule` pattern.

**Non-Goals:**
- `project add` wizard prompt for ports.
- Auto-recreate / `--replace` flow when ports change after creation.
- Documenting or testing the egress-policy interaction with published ports (left as a follow-up; the published-port path is runtime-managed ingress, independent of the egress `NetworkPolicy`).

## Decisions

### D1: Structured objects over Docker-style strings

**Choice**: `PortSpec` structured objects (`{ hostPort, guestPort?, protocol?, bind? }`) in `projects.json`, not Docker-style strings like `"8080:8080"`.

**Why**: The user prefers explicit, type-safe objects. Structured entries give compile-time field checking, clearer validation errors, and avoid ambiguity (e.g. whether the first number is host or guest). The cost is a more verbose config, which is acceptable for a project registry that is edited infrequently.

**Alternatives considered:**
- Docker-style strings (`"8080:8080"`, `"0.0.0.0:8080:8080"`, `"5353:5353/udp"`): familiar and compact, but require a string parser and lose type safety at the config boundary.

### D2: Loopback-only default bind

**Choice**: When `bind` is omitted, default to `127.0.0.1` (loopback only).

**Why**: The project's security model is least-privilege throughout (deny-by-default egress, scoped secrets, no blanket mounts). Loopback-only keeps published ports reachable from the host without exposing them to the LAN or external network. Exposing to other interfaces requires an explicit `bind: "0.0.0.0"` (or a specific interface address), making the security-relevant choice visible in config.

This matches the SDK's own default: bare `.port(host, guest)` binds `127.0.0.1`.

**Alternatives considered:**
- Default `0.0.0.0` (all interfaces): more convenient for LAN dev, but contradicts the project's least-privilege stance and would silently expose services.

### D3: `guestPort` defaults to `hostPort`

**Choice**: When `guestPort` is omitted, it defaults to `hostPort`.

**Why**: The common case is forwarding the same port number on both sides (`8080:8080`). Defaulting reduces config verbosity for the common case while keeping the field available for remapping (e.g. host 80 → guest 8080).

### D4: Parser lives in `src/lib/network.ts`

**Choice**: Add `parsePortSpec` to `src/lib/network.ts` alongside `parseAllowRule`.

**Why**: Both are network-related string/object parsers with the same validation style (integer range checks, protocol enum, clear error messages). Co-locating them keeps the network parsing surface in one module and matches the existing test layout (`tests/network.test.ts` covers `parseAllowRule`).

## Open Questions

- **Egress/ingress interaction**: Does a deny-by-default egress `NetworkPolicy` affect a guest's ability to *listen* on a published port? Published ports are runtime-managed ingress (the host forwards to the guest), so they should be independent of the egress policy — but this is unverified. Left as a follow-up spike rather than blocking this change. If it turns out egress policy interferes, the fix would be in `buildNetworkPolicy` (add an ingress allow rule), not in this change's port wiring.
