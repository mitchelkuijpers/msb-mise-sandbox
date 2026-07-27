import { describe, expect, test } from "bun:test";
import { assertSecretSourcesPresent, redactSecretValues, MissingSecretError } from "../src/config/secrets-check.js";
import { BUILTIN_DEFAULTS, type SandboxConfig } from "../src/config/types.js";

function baseConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    ...BUILTIN_DEFAULTS,
    identity: { name: "p", workdir: "/workspace" },
    build: { ...BUILTIN_DEFAULTS.build, tag: "p:dev", from: "ubuntu:24.04", builderImage: "ubuntu:24.04" },
    runtime: { cpus: 4, memory: "8G" },
    workdirTarget: "/workspace",
    mounts: {},
    ports: {},
    network: { defaultEgress: "allow", allow: [], inherit: true },
    env: {},
    secrets: {},
    labels: {},
    ...overrides,
  };
}

describe("assertSecretSourcesPresent", () => {
  test("passes when all referenced env vars are set", () => {
    const config = baseConfig({
      secrets: {
        OPENAI_API_KEY: { from: "OPENAI_API_KEY", hosts: ["api.openai.com"] },
      },
    });
    expect(() =>
      assertSecretSourcesPresent(config, { OPENAI_API_KEY: "sk-abc" }),
    ).not.toThrow();
  });

  test("fails when a source env var is missing", () => {
    const config = baseConfig({
      secrets: {
        OPENAI_API_KEY: { from: "OPENAI_API_KEY", hosts: ["api.openai.com"] },
      },
    });
    expect(() => assertSecretSourcesPresent(config, {})).toThrow(MissingSecretError);
    expect(() => assertSecretSourcesPresent(config, {})).toThrow(/OPENAI_API_KEY/);
  });

  test("fails when source is an empty string", () => {
    const config = baseConfig({
      secrets: { K: { from: "", hosts: ["api.example"] } },
    });
    expect(() => assertSecretSourcesPresent(config, { K: "value" })).toThrow(MissingSecretError);
  });

  test("never reads or returns secret values", () => {
    const config = baseConfig({
      secrets: {
        K: { from: "K", hosts: ["api.example"] },
      },
    });
    const env = { K: "supersecret" };
    // Call should succeed; we only assert it does not throw.
    expect(() => assertSecretSourcesPresent(config, env)).not.toThrow();
    // And the return is void — we cannot accidentally retrieve the value.
    const result = assertSecretSourcesPresent(config, env);
    expect(result).toBeUndefined();
  });
});

describe("redactSecretValues", () => {
  test("replaces known secret values with placeholders", () => {
    const config = baseConfig({
      secrets: { K: { from: "K", hosts: ["api.example"] } },
    });
    const env = { K: "supersecret" };
    const out = redactSecretValues("the value is supersecret and again supersecret", config, env);
    expect(out).toBe("the value is <K> and again <K>");
  });

  test("leaves text unchanged when secret not in env", () => {
    const config = baseConfig({
      secrets: { K: { from: "K", hosts: ["api.example"] } },
    });
    const out = redactSecretValues("nothing to redact", config, {});
    expect(out).toBe("nothing to redact");
  });
});
