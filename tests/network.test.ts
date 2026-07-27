/**
 * Unit tests for src/lib/network.ts — network rule parser.
 */

import { describe, it, expect } from "bun:test";
import { parseAllowRule, parsePortSpec } from "../src/lib/network.js";

describe("parseAllowRule", () => {
  it("parses a basic tcp rule", () => {
    const r = parseAllowRule("gitlab.com:tcp:443");
    expect(r).toEqual({ host: "gitlab.com", protocol: "tcp", port: 443 });
  });

  it("parses a basic udp rule", () => {
    const r = parseAllowRule("dns.example.com:udp:53");
    expect(r).toEqual({ host: "dns.example.com", protocol: "udp", port: 53 });
  });

  it("parses a wildcard suffix rule", () => {
    const r = parseAllowRule("*.openai.com:tcp:443");
    expect(r).toEqual({ host: "*.openai.com", protocol: "tcp", port: 443 });
  });

  it("parses a rule with numeric host (edge)", () => {
    const r = parseAllowRule("127.0.0.1:tcp:8080");
    expect(r.host).toBe("127.0.0.1");
    expect(r.port).toBe(8080);
  });

  it("rejects missing parts", () => {
    expect(() => parseAllowRule("gitlab.com:tcp")).toThrow(/expected/);
  });

  it("rejects too many parts", () => {
    expect(() => parseAllowRule("a:b:c:d")).toThrow(/expected/);
  });

  it("rejects invalid protocol", () => {
    expect(() => parseAllowRule("host:sctp:443")).toThrow(/must be "tcp"/);
  });

  it("rejects non-numeric port", () => {
    expect(() => parseAllowRule("host:tcp:abc")).toThrow(/must be an integer/);
  });

  it("rejects port 0", () => {
    expect(() => parseAllowRule("host:tcp:0")).toThrow(/must be an integer/);
  });

  it("rejects port > 65535", () => {
    expect(() => parseAllowRule("host:tcp:70000")).toThrow(/must be an integer/);
  });

  it("rejects non-integer port", () => {
    expect(() => parseAllowRule("host:tcp:22.5")).toThrow(/must be an integer/);
  });
});

describe("parsePortSpec", () => {
  it("applies defaults for a minimal spec", () => {
    const p = parsePortSpec({ hostPort: 8080 });
    expect(p).toEqual({
      hostPort: 8080,
      guestPort: 8080,
      protocol: "tcp",
      bind: "127.0.0.1",
    });
  });

  it("parses an explicit udp port", () => {
    const p = parsePortSpec({ hostPort: 5353, protocol: "udp" });
    expect(p.protocol).toBe("udp");
    expect(p.hostPort).toBe(5353);
    expect(p.guestPort).toBe(5353);
    expect(p.bind).toBe("127.0.0.1");
  });

  it("honors an explicit bind of 0.0.0.0", () => {
    const p = parsePortSpec({ hostPort: 80, bind: "0.0.0.0" });
    expect(p.bind).toBe("0.0.0.0");
    expect(p.protocol).toBe("tcp");
  });

  it("honors an explicit guest port remap", () => {
    const p = parsePortSpec({ hostPort: 80, guestPort: 8080 });
    expect(p.hostPort).toBe(80);
    expect(p.guestPort).toBe(8080);
  });

  it("rejects hostPort 0", () => {
    expect(() => parsePortSpec({ hostPort: 0 })).toThrow(/must be an integer 1-65535/);
  });

  it("rejects hostPort > 65535", () => {
    expect(() => parsePortSpec({ hostPort: 65536 })).toThrow(/must be an integer 1-65535/);
  });

  it("rejects non-integer hostPort", () => {
    expect(() => parsePortSpec({ hostPort: 22.5 })).toThrow(/must be an integer 1-65535/);
  });

  it("rejects non-numeric hostPort", () => {
    expect(() =>
      parsePortSpec({ hostPort: "8080" as unknown as number }),
    ).toThrow(/must be an integer 1-65535/);
  });

  it("rejects missing hostPort", () => {
    expect(() => parsePortSpec({} as { hostPort: number })).toThrow(
      /must be an integer 1-65535/,
    );
  });

  it("rejects invalid guestPort", () => {
    expect(() =>
      parsePortSpec({ hostPort: 80, guestPort: 0 }),
    ).toThrow(/must be an integer 1-65535/);
  });

  it("rejects invalid protocol", () => {
    expect(() =>
      parsePortSpec({ hostPort: 80, protocol: "sctp" as "tcp" }),
    ).toThrow(/protocol must be "tcp" or "udp"/);
  });

  it("rejects non-object input", () => {
    expect(() => parsePortSpec(null as unknown as { hostPort: number })).toThrow(
      /expected an object/,
    );
    expect(() =>
      parsePortSpec("nope" as unknown as { hostPort: number }),
    ).toThrow(/expected an object/);
  });
});
