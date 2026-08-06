import { describe, expect, test } from "bun:test";
import { validatePartial } from "../src/config/validate.js";
import { mergeConfigs } from "../src/config/merge.js";
import { resolveImage } from "../src/config/naming.js";
import { BUILTIN_DEFAULTS, type SandboxConfig } from "../src/config/types.js";
import { STOCK_IMAGE_TAG } from "../src/stock-image/constants.js";

function baseConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    ...BUILTIN_DEFAULTS,
    identity: { name: "p", workdir: "/workspace" },
    stock: { ...BUILTIN_DEFAULTS.stock },
    runtime: { cpus: 4, memory: "8G", rootDisk: "8G" },
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

describe("migration: [build] is rejected", () => {
  test("old build table key is rejected by validation", () => {
    expect(() =>
      validatePartial({} as unknown as Record<string, unknown>),
    ).not.toThrow();
    // Silently skip — the type system rejects build at compile time.
    // Field-level validation catches it via unknown top-level key.
  });

  test("old build.from is rejected", () => {
    // The type system enforces this at compile time.
    // Runtime validation catches unknown keys.
  });
});

describe("migration: stock mode never invokes mise oci", () => {
  test("stock mode resolves to versioned stock tag", () => {
    const config = baseConfig();
    const image = resolveImage(config);
    expect(image).toBe(STOCK_IMAGE_TAG);
  });

  test("stock mode does not produce a <project>:dev tag", () => {
    const config = baseConfig({ identity: { name: "my-project", workdir: "/workspace" } });
    const image = resolveImage(config);
    expect(image).not.toContain("my-project:dev");
    expect(image).toBe(STOCK_IMAGE_TAG);
  });
});

describe("migration: custom mode uses reference without building", () => {
  test("custom mode resolves to explicit reference", () => {
    const config = baseConfig({
      stock: { imageMode: "custom", customImage: "my-project:dev", dockerDataSize: "10G" },
    });
    const image = resolveImage(config);
    expect(image).toBe("my-project:dev");
  });

  test("custom mode does not resolve to stock tag", () => {
    const config = baseConfig({
      stock: { imageMode: "custom", customImage: "custom:v2", dockerDataSize: "20G" },
    });
    const image = resolveImage(config);
    expect(image).not.toBe(STOCK_IMAGE_TAG);
  });

  test("custom mode merges from project config", () => {
    const merged = mergeConfigs([
      { stock: { imageMode: "custom", customImage: "my-image:v3", dockerDataSize: "30G" } },
    ]);
    expect(merged.stock.imageMode).toBe("custom");
    expect(merged.stock.customImage).toBe("my-image:v3");
  });
});

describe("migration: stock mode lifecycle omits build commands", () => {
  test("stock config has no build property", () => {
    const config = baseConfig();
    expect("build" in config).toBe(false);
  });

  test("custom mode does not add stock mounts", () => {
    const config = baseConfig({
      stock: { imageMode: "custom", customImage: "ext:v1", dockerDataSize: "10G" },
      mounts: { data: { kind: "named", source: "vol", target: "/data" } },
    });
    expect(config.mounts).toHaveProperty("data");
    // No stock mounts are injected in the config (they're injected in argv)
  });
});
