import { describe, expect, test } from "bun:test";
import { validateLayers, validateMerged, validatePartial } from "../src/config/validate.js";
import { mergeConfigs } from "../src/config/merge.js";
import { loadConfig } from "../src/config/index.js";
import type { SandboxConfig } from "../src/config/types.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("validatePartial", () => {
  test("rejects unknown keys under [runtime]", () => {
    expect(() =>
      validatePartial({ runtime: { memroy: "8G" } as unknown as { cpus?: number; memory?: string } }),
    ).toThrow(/runtime\.memroy|unknown/);
  });

  test("rejects non-integer cpus", () => {
    expect(() => validatePartial({ runtime: { cpus: 1.5 } })).toThrow(/runtime\.cpus/);
  });

  test("rejects invalid memory format", () => {
    expect(() => validatePartial({ runtime: { memory: "8X" } })).toThrow(/runtime\.memory/);
  });

  test("rejects non-absolute mount target", () => {
    expect(() =>
      validatePartial({
        mounts: { workspace: { kind: "dir", source: ".", target: "workspace" } },
      }),
    ).toThrow(/mounts\.workspace\.target/);
  });

  test("rejects out-of-range port", () => {
    expect(() =>
      validatePartial({
        ports: { web: { hostPort: 70000 } },
      }),
    ).toThrow(/ports\.web\.hostPort/);
  });

  test("rejects malformed network rule", () => {
    expect(() =>
      validatePartial({
        network: { allow: ["bad-rule"] },
      }),
    ).toThrow(/network\.allow/);
  });

  test("rejects invalid env variable name", () => {
    expect(() => validatePartial({ env: { "1bad": "x" } })).toThrow(/env\.1bad/);
  });
});

describe("validateLayers", () => {
  test("reports the source file in the error", () => {
    const home = makeTmp("vl");
    const cfg = join(home, "bad.toml");
    writeFileSync(cfg, "[runtime]\ncpus = -1\n");
    expect(() => validateLayers([{ source: cfg, config: { runtime: { cpus: -1 } } }])).toThrow(/bad\.toml/);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("validateMerged", () => {
  test("rejects empty image tag", () => {
    const merged: SandboxConfig = {
      identity: { name: "p", workdir: "/workspace" },
      build: { from: "ubuntu:24.04", tag: "", builderImage: "ubuntu:24.04" },
      runtime: { cpus: 4, memory: "8G" },
      workdirTarget: "/workspace",
      mounts: {},
      ports: {},
      network: { defaultEgress: "allow", allow: [], inherit: true },
      env: {},
      secrets: {},
      labels: {},
    };
    expect(() => validateMerged(merged)).toThrow(/build\.tag/);
  });
});

describe("integration with mergeConfigs", () => {
  test("merge + validate end-to-end", () => {
    const merged = mergeConfigs([
      { runtime: { cpus: 6, memory: "16G" } },
      { env: { NODE_ENV: "production" } },
      { network: { defaultEgress: "deny", allow: ["github.com:tcp:443"] } },
    ]);
    // Apply identity defaults (as loadConfig would).
    merged.identity.name = "p";
    merged.build.tag = "p:dev";
    expect(() => validateMerged(merged)).not.toThrow();
  });
});

describe("loadConfig end-to-end", () => {
  test("discovers project .sandbox.toml and applies identity defaults", async () => {
    const dir = makeTmp("e2e");
    writeFileSync(
      join(dir, ".sandbox.toml"),
      '[runtime]\ncpus = 6\n[network]\ndefaultEgress = "deny"\nallow = ["github.com:tcp:443"]\n',
    );
    const { config } = await loadConfig({ cwd: dir, homeDir: "/nonexistent" });
    expect(config.runtime.cpus).toBe(6);
    expect(config.network.defaultEgress).toBe("deny");
    expect(config.identity.name).toBeTruthy();
    expect(config.build.tag).toBe(`${config.identity.name}:dev`);
    rmSync(dir, { recursive: true, force: true });
  });

  test("missing optional files do not fail", async () => {
    const dir = makeTmp("e2e-empty");
    const { config } = await loadConfig({ cwd: dir, homeDir: "/nonexistent" });
    expect(config.runtime.cpus).toBe(4);
    rmSync(dir, { recursive: true, force: true });
  });
});

function makeTmp(label: string): string {
  const dir = join(tmpdir(), `mise-msb-${label}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
