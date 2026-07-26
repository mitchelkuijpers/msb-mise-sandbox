/**
 * Unit tests for src/lib/sandbox.ts — helper functions.
 */

import { describe, it, expect, vi } from "vitest";
import { parseMemoryMib, createSandbox } from "../src/lib/sandbox.js";
import type { ProjectConfig } from "../src/types.js";

// Mock the microsandbox SDK so createSandbox can be exercised without a
// running daemon. createSandbox only uses Sandbox.builder(...) then chains
// fluent calls; the network callback (which needs Rule/Destination/PortRange)
// is never invoked by the mock create(), so a minimal Sandbox export suffices.
vi.mock("microsandbox", () => {
  function makeBuilder() {
    const calls: Array<[string, ...unknown[]]> = [];
    const volumeCbs: Array<[string, (v: any) => unknown]> = [];
    const networkCbs: Array<(nb: any) => unknown> = [];
    const sb: any = {
      image(r: string) { calls.push(["image", r]); return sb; },
      detached(v: boolean) { calls.push(["detached", v]); return sb; },
      pullPolicy(p: string) { calls.push(["pullPolicy", p]); return sb; },
      cpus(n: number) { calls.push(["cpus", n]); return sb; },
      memory(n: number) { calls.push(["memory", n]); return sb; },
      volume(path: string, cb: (v: any) => unknown) {
        volumeCbs.push([path, cb]);
        calls.push(["volume", path]);
        return sb;
      },
      env(k: string, v: string) { calls.push(["env", k, v]); return sb; },
      network(cb: (nb: any) => unknown) { networkCbs.push(cb); calls.push(["network"]); return sb; },
      async create() {
        return { name: "mock", calls, volumeCbs, networkCbs };
      },
    };
    return sb;
  }
  return { Sandbox: { builder: (_name: string) => makeBuilder() } };
});

/** Minimal config with the stock image and no secrets. */
function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    gitlab: { url: "https://gitlab.com/test", tokenRef: "env:TOKEN" },
    ...overrides,
  };
}

/**
 * Run createSandbox and return the recorded `namedWith` args for the
 * /var/lib/docker volume, or undefined if no such volume was configured.
 */
async function dockerVolumeNamedWithArgs(
  cfg: ProjectConfig,
): Promise<[string, string, string, number] | undefined> {
  const result: any = await createSandbox("proj", cfg);
  const entry = result.volumeCbs.find(
    ([p]: [string]) => p === "/var/lib/docker",
  );
  if (!entry) return undefined;
  const recorded: any[] = [];
  entry[1]({ namedWith: (...a: any[]) => { recorded.push(a); return {}; } });
  return recorded[0] as [string, string, string, number];
}

describe("parseMemoryMib", () => {
  it("parses GiB to MiB", () => {
    expect(parseMemoryMib("8G")).toBe(8192);
    expect(parseMemoryMib("4G")).toBe(4096);
    expect(parseMemoryMib("1G")).toBe(1024);
  });

  it("parses MiB directly", () => {
    expect(parseMemoryMib("512M")).toBe(512);
    expect(parseMemoryMib("1024M")).toBe(1024);
  });

  it("parses KiB (rounded)", () => {
    expect(parseMemoryMib("1024K")).toBe(1);
    expect(parseMemoryMib("2048K")).toBe(2);
  });

  it("parses bare number as MiB", () => {
    expect(parseMemoryMib("256")).toBe(256);
    expect(parseMemoryMib("1024")).toBe(1024);
  });

  it("rejects invalid format", () => {
    expect(() => parseMemoryMib("abc")).toThrow(/Invalid memory spec/);
  });

  it("rejects unknown unit", () => {
    // "T" is not matched by the regex [KMG]? at all, so it hits the
    // "Invalid memory spec" branch before the switch on unit letter.
    expect(() => parseMemoryMib("1T")).toThrow(/Invalid memory spec/);
  });
});

describe("createSandbox docker support", () => {
  it("mounts the docker data volume when docker.enabled is true", async () => {
    const args = await dockerVolumeNamedWithArgs(
      baseConfig({ docker: { enabled: true } }),
    );
    expect(args).toEqual(["proj-docker-data", "ensure-exists", "disk", 10240]);
  });

  it("does not mount /var/lib/docker when docker is disabled", async () => {
    const args = await dockerVolumeNamedWithArgs(baseConfig());
    expect(args).toBeUndefined();
  });

  it("does not mount /var/lib/docker when docker.enabled is false", async () => {
    const args = await dockerVolumeNamedWithArgs(
      baseConfig({ docker: { enabled: false } }),
    );
    expect(args).toBeUndefined();
  });

  it("converts a custom dataVolumeSize to MiB", async () => {
    const args = await dockerVolumeNamedWithArgs(
      baseConfig({ docker: { enabled: true, dataVolumeSize: "50G" } }),
    );
    expect(args?.[3]).toBe(51200);
  });

  it("rejects docker.enabled with a non-stock image", async () => {
    await expect(
      createSandbox("proj", baseConfig({ image: "custom:1", docker: { enabled: true } })),
    ).rejects.toThrow(/requires the stock agent-sandbox:latest image/);
  });

  it("accepts the stock image alias with docker enabled", async () => {
    const args = await dockerVolumeNamedWithArgs(
      baseConfig({
        image: "docker.io/library/agent-sandbox:latest",
        docker: { enabled: true },
      }),
    );
    expect(args).toEqual(["proj-docker-data", "ensure-exists", "disk", 10240]);
  });
});
