/**
 * Integration tests for sandbox lifecycle (OpenSpec task 4.4) and
 * secrets (OpenSpec task 5.5).
 *
 * These tests exercise the real microsandbox SDK and daemon. They
 * require:
 *   - `msb` CLI installed and microsandbox daemon running
 *   - The OCI image **ubuntu:latest** cached (for 4.4 — `echo` only)
 *   - The OCI image **python:3.12-slim** cached  (for 5.5 — Python HTTP)
 *   - (5.5 substitution) External HTTPS access to **httpbin.org**
 *
 * ── Gating ──────────────────────────────────────────────────────────
 *
 *   RUN_MSB_INTEGRATION=1   Enable the integration tests.
 *                           Without this flag all tests are skipped.
 *
 *   MSB_TEST_SUBSTITUTION=1 Additionally gate the httpbin.org
 *                           substitution subtest (task 5.5).
 *                           Requires outbound HTTPS to httpbin.org.
 *
 * ── Prerequisites ───────────────────────────────────────────────────
 *
 * Before running these tests, ensure:
 *   1. microsandbox daemon is running  (`msb doctor`)
 *   2. ubuntu:latest is cached         (`msb pull ubuntu:latest`)
 *   3. python:3.12-slim is cached      (`msb pull python:3.12-slim`)
 *
 * ── Flakiness notes ─────────────────────────────────────────────────
 *
 * - Sandbox creation fails if the daemon is not running or an image is
 *   not cached.  Run `msb doctor` first to verify the daemon is healthy.
 * - The httpbin.org substitution test depends on a third-party service
 *   that may be slow or temporarily unavailable.
 * - Names include a timestamp to avoid conflicts with sandboxes from
 *   aborted runs.  If a test fails mid-way you may need to manually
 *   clean up with `msb remove <name>`.
 * - The blocked-host connection attempt uses a 5-second timeout so it
 *   completes quickly even when the packet is dropped by the policy.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  Sandbox,
  Rule,
  Destination,
  PortRange,
} from "microsandbox";

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

const INTEGRATION = process.env.RUN_MSB_INTEGRATION === "1";
const TEST_SUBSTITUTION = process.env.MSB_TEST_SUBSTITUTION === "1";

// Choose the right suite runner based on the env gate
const testSuite = INTEGRATION ? describe : describe.skip;
const subTest = TEST_SUBSTITUTION ? it : it.skip;

/** Unique suffix so parallel/aborted runs do not collide. */
const TS = String(Date.now());

// ---------------------------------------------------------------------------
// 4.4  Sandbox lifecycle — create, exec "echo hello", stop, remove
// ---------------------------------------------------------------------------

testSuite("task 4.4: sandbox lifecycle", () => {
  const name = `test-44-${TS}`;

  it("creates a sandbox, exec echo hello, verifies output, stops and removes", async () => {
    const sb = await Sandbox.builder(name)
      .image("ubuntu:latest")
      .cpus(2)
      .memory(512)
      .create();

    expect(sb.name).toBe(name);

    // ── exec ────────────────────────────────────────────────────────
    const out = await sb.exec("echo", ["hello"]);
    expect(out.success).toBe(true);
    expect(out.stdout()).toBe("hello\n");

    // ── stop + remove ───────────────────────────────────────────────
    await sb.stop();
    await Sandbox.remove(name);

    // Verify the sandbox is gone from the database
    const handles = await Sandbox.list();
    const found = handles.find((h) => h.name === name);
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5.5  Secrets integration — env-var bridge + NetworkBuilder secrets +
//      TLS interception, substitution to allowed host, blocked host
// ---------------------------------------------------------------------------

testSuite("task 5.5: secrets integration", () => {
  const name = `test-55-${TS}`;

  // Test-only secret values — NOT real credentials.  They verify the
  // placeholder-substitution mechanism without depending on external
  // env vars.  The real-value test (substitution via httpbin.org) is
  // gated separately (see MSB_TEST_SUBSTITUTION above).
  const secretValue1 = "msb-test-alpha-value";
  const secretValue2 = "msb-test-beta-value";

  let sb: Sandbox;

  beforeAll(async () => {
    sb = await Sandbox.builder(name)
      .image("python:3.12-slim")
      .cpus(2)
      .memory(512)

      // ── Env-var bridge ───────────────────────────────────────────
      // Tool-facing env vars hold the literal placeholder string, NOT
      // the real value.  The TLS proxy substitutes at the boundary.
      .env("TOKEN_ALPHA", "$MSB_ALPHA_REAL")
      .env("TOKEN_BETA", "$MSB_BETA_REAL")

      // ── Network ➔ secrets + TLS + policy ─────────────────────────
      .network((n: any) =>
        n
          // Enable TLS interception (required for secret substitution)
          .tls((t: any) => t)

          // Secret 1 (GitLab-style — allowHost)
          .secret((s: any) =>
            s
              .env("ALPHA_REAL")
              .value(secretValue1)
              .placeholder("$MSB_ALPHA_REAL")
              .allowHost("httpbin.org"),
          )

          // Secret 2 (OpenAI-style — independent value + host)
          .secret((s: any) =>
            s
              .env("BETA_REAL")
              .value(secretValue2)
              .placeholder("$MSB_BETA_REAL")
              .allowHost("httpbin.org"),
          )

          // Deny-by-default egress; only httpbin.org:443 allowed
          .policy({
            defaultEgress: "deny",
            defaultIngress: "allow",
            rules: [
              Rule.allowDns(),
              {
                direction: "egress",
                destination: Destination.domain("httpbin.org"),
                protocols: ["tcp"],
                ports: [PortRange.single(443)],
                action: "allow",
              },
            ],
          }),
      )
      .create();
  });

  afterAll(async () => {
    await sb.stop().catch(() => {});
    await Sandbox.remove(name).catch(() => {});
  });

  // ═══════════════════════════════════════════════════════════════════
  //  1.  Env-var bridge  —  placeholder in guest env,
  //      real value NEVER present
  // ═══════════════════════════════════════════════════════════════════

  it("env-var bridge: guest env shows placeholder, not real value", async () => {
    const envOut = await sb.exec("sh", [
      "-c",
      "echo TOKEN_ALPHA=$TOKEN_ALPHA && echo TOKEN_BETA=$TOKEN_BETA",
    ]);
    expect(envOut.success).toBe(true);
    const envStdout = envOut.stdout();
    expect(envStdout).toContain("TOKEN_ALPHA=$MSB_ALPHA_REAL");
    expect(envStdout).toContain("TOKEN_BETA=$MSB_BETA_REAL");
    // Real values must NOT leak into the guest environment
    expect(envStdout).not.toContain(secretValue1);
    expect(envStdout).not.toContain(secretValue2);
  });

  // ═══════════════════════════════════════════════════════════════════
  //  2.  Allowed-host substitution (gated — requires httpbin.org)
  // ═══════════════════════════════════════════════════════════════════

  subTest("substitutes placeholder for allowed host (httpbin.org)", async () => {
    // Send the placeholder to httpbin.org/headers, which echoes
    // back request headers as JSON.  If the TLS proxy substitutes,
    // the response shows the real value; otherwise the literal
    // placeholder passes through.
    const subScript = `
import urllib.request, json, sys
try:
    req = urllib.request.Request("https://httpbin.org/headers")
    req.add_header("Authorization", "Bearer $MSB_ALPHA_REAL")
    resp = urllib.request.urlopen(req, timeout=15)
    data = json.loads(resp.read())
    auth = data.get("headers", {}).get("Authorization", "NOT_FOUND")
    print(auth)
except Exception as e:
    print("SUBSTITUTION_FAILED: " + str(e))
    sys.exit(1)
`;
    const subOut = await sb.exec("python3", ["-c", subScript]);
    expect(subOut.success).toBe(true);
    const subStdout = subOut.stdout();

    // The echoed Authorization header MUST contain the real value
    expect(subStdout).toContain(secretValue1);
    // The placeholder MUST NOT appear in the echoed header
    expect(subStdout).not.toContain("$MSB_ALPHA_REAL");
    expect(subStdout).not.toContain("$MSB_BETA_REAL");
  });

  // ═══════════════════════════════════════════════════════════════════
  //  3.  Blocked host  —  example.com is NOT in the allow list,
  //      so HTTPS egress is denied by the network policy
  // ═══════════════════════════════════════════════════════════════════

  it("blocks egress to host not in allow list", async () => {
    const blockedScript = `
import urllib.request, urllib.error, sys
try:
    resp = urllib.request.urlopen("https://example.com", timeout=5)
    print("REACHABLE:" + str(resp.status))
    sys.exit(1)
except Exception as e:
    print("BLOCKED:" + str(e))
    sys.exit(1)
`;
    const blockedOut = await sb.exec("python3", ["-c", blockedScript]);
    // The request should fail (network policy denies egress to
    // example.com); the script exits 1 and prints BLOCKED:...
    expect(blockedOut.success).toBe(false);
    expect(blockedOut.stdout()).toContain("BLOCKED:");
  });
});
