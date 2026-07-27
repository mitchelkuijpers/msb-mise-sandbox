/**
 * Network policy builder — parses `network.allow` rules into a
 * microsandbox `NetworkPolicy` data object using the official
 * `Rule`, `Destination`, and `PortRange` factories.
 *
 * Rule format: `<host>:<protocol>:<port>`
 *   - host: exact domain OR `*.`-prefixed suffix pattern
 *   - protocol: `tcp` | `udp`
 *   - port: 1-65535
 *
 * Examples:
 *   - `gitlab.com:tcp:443`
 *   - `*.openai.com:tcp:443`
 *   - `registry.npmjs.org:tcp:443`
 */

import {
  Rule,
  Destination,
  PortRange,
} from "microsandbox";
import type { NetworkPolicy } from "microsandbox";
import type { NetworkConfig, PortSpec } from "../types.js";

// ---------------------------------------------------------------------------
// Parsed rule
// ---------------------------------------------------------------------------

export interface ParsedAllowRule {
  /** Exact domain name or `*.`-prefixed suffix. */
  host: string;
  protocol: "tcp" | "udp";
  port: number;
}

/** Default bind address for published ports (loopback only). */
export const DEFAULT_PORT_BIND = "127.0.0.1";

/** Normalized port spec with all defaults resolved. */
export interface ParsedPortSpec {
  hostPort: number;
  guestPort: number;
  protocol: "tcp" | "udp";
  bind: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a single allow-rule string of the form `host:protocol:port`.
 *
 * Throws if the format is invalid.
 */
export function parseAllowRule(rule: string): ParsedAllowRule {
  const parts = rule.split(":");
  if (parts.length !== 3) {
    throw new Error(
      `Invalid network allow rule "${rule}": expected <host>:<protocol>:<port>`,
    );
  }
  const [host, protocolStr, portStr] = parts;

  if (protocolStr !== "tcp" && protocolStr !== "udp") {
    throw new Error(
      `Invalid protocol "${protocolStr}" in rule "${rule}": must be "tcp" or "udp"`,
    );
  }

  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port "${portStr}" in rule "${rule}": must be an integer 1-65535`,
    );
  }

  return { host, protocol: protocolStr, port };
}

// ---------------------------------------------------------------------------
// Port spec parser
// ---------------------------------------------------------------------------

function validatePortNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(
      `Invalid port spec: ${field} must be an integer 1-65535 (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

/**
 * Parse and normalize a single `PortSpec` entry. Defaults are applied:
 *   - `guestPort` → `hostPort`
 *   - `protocol`  → `"tcp"`
 *   - `bind`      → `"127.0.0.1"`
 *
 * Throws on missing/invalid `hostPort`, invalid `guestPort` or `protocol`.
 */
export function parsePortSpec(spec: PortSpec): ParsedPortSpec {
  if (spec === null || typeof spec !== "object") {
    throw new Error(
      `Invalid port spec: expected an object (got ${typeof spec})`,
    );
  }

  const hostPort = validatePortNumber(
    (spec as { hostPort?: unknown }).hostPort,
    "hostPort",
  );

  let guestPort = hostPort;
  if ((spec as { guestPort?: unknown }).guestPort !== undefined) {
    guestPort = validatePortNumber(
      (spec as { guestPort?: unknown }).guestPort,
      "guestPort",
    );
  }

  const protocol = (spec as { protocol?: unknown }).protocol;
  if (protocol !== undefined && protocol !== "tcp" && protocol !== "udp") {
    throw new Error(
      `Invalid port spec: protocol must be "tcp" or "udp" (got ${JSON.stringify(protocol)})`,
    );
  }

  const bind =
    (spec as { bind?: unknown }).bind !== undefined
      ? String((spec as { bind?: unknown }).bind)
      : DEFAULT_PORT_BIND;

  return { hostPort, guestPort, protocol: protocol ?? "tcp", bind };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a `NetworkPolicy` data object from `NetworkConfig`.
 *
 * Pass the returned policy to `NetworkBuilder.policy()` inside the
 * `.network(nb => …)` callback on a `SandboxBuilder`.
 *
 * When the default policy is `"deny"` an explicit `Rule.allowDns()`
 * rule is prepended so domain-based allow rules can resolve.
 */
export function buildNetworkPolicy(
  config: Required<Pick<NetworkConfig, "defaultEgress" | "allow">>,
): NetworkPolicy {
  const rules: import("microsandbox").Rule[] = [];

  if (config.defaultEgress === "deny") {
    // Prepend a proper DNS allow rule so domain-based rules can resolve.
    rules.push(Rule.allowDns());
  }

  for (const ruleStr of config.allow) {
    const r = parseAllowRule(ruleStr);

    const destination =
      r.host.startsWith("*.")
        ? Destination.domainSuffix(r.host.slice(2))
        : Destination.domain(r.host);

    rules.push({
      direction: "egress",
      destination,
      protocols: [r.protocol],
      ports: [PortRange.single(r.port)],
      action: "allow",
    });
  }

  return {
    defaultEgress: config.defaultEgress === "deny" ? "deny" : "allow",
    defaultIngress: "allow",
    rules,
  };
}
