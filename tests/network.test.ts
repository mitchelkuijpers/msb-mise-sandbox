/**
 * Unit tests for src/lib/network.ts — network rule parser.
 */

import { describe, it, expect } from "vitest";
import { parseAllowRule } from "../src/lib/network.js";

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
