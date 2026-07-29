import { describe, expect, test } from "bun:test";
import { mergeConfigs } from "../src/config/merge.js";
import type { PartialConfig } from "../src/config/types.js";

describe("mergeConfigs", () => {
  test("scalar override: project cpus replace personal", () => {
    const merged = mergeConfigs([
      { runtime: { cpus: 2 } },
      { runtime: { cpus: 6 } },
    ]);
    expect(merged.runtime.cpus).toBe(6);
  });

  test("env deep merge: later keys override earlier", () => {
    const merged = mergeConfigs([
      { env: { A: "1", B: "2" } },
      { env: { B: "3", C: "4" } },
    ]);
    expect(merged.env).toEqual({ A: "1", B: "3", C: "4" });
  });

  test("named tables merge by entry name", () => {
    const merged = mergeConfigs([
      {
        mounts: {
          cache: { kind: "named", source: "vol1", target: "/tmp/a" },
        },
      },
      {
        mounts: {
          workspace: { kind: "dir", source: ".", target: "/workspace" },
          cache: { kind: "named", source: "vol2", target: "/tmp/b" },
        },
      },
    ]);
    expect(Object.keys(merged.mounts).sort()).toEqual(["cache", "workspace"]);
    expect(merged.mounts.cache?.target).toBe("/tmp/b");
    expect(merged.mounts.workspace?.target).toBe("/workspace");
  });

  test("network.allow inherits and dedupes by default", () => {
    const merged = mergeConfigs([
      { network: { allow: ["github.com:tcp:443", "a.example:tcp:443"] } },
      { network: { allow: ["a.example:tcp:443", "b.example:tcp:443"] } },
    ]);
    expect(merged.network.inherit).toBe(true);
    expect(merged.network.allow).toEqual([
      "github.com:tcp:443",
      "a.example:tcp:443",
      "b.example:tcp:443",
    ]);
  });

  test("network.inherit = false resets allow to overlay only", () => {
    const merged = mergeConfigs([
      { network: { allow: ["github.com:tcp:443"] } },
      {
        network: {
          allow: ["only.example:tcp:443"],
          inherit: false,
        },
      },
    ]);
    expect(merged.network.inherit).toBe(false);
    expect(merged.network.allow).toEqual(["only.example:tcp:443"]);
  });

  test("command arrays replace rather than concatenate", () => {
    const merged = mergeConfigs([
      { command: { argv: ["bash", "-l"] } },
      { command: { argv: ["fish"] } },
    ]);
    expect(merged.command?.argv).toEqual(["fish"]);
  });

  test("empty layers produce built-in defaults", () => {
    const merged = mergeConfigs([]);
    expect(merged.runtime.cpus).toBe(4);
    expect(merged.runtime.memory).toBe("8G");
    expect(merged.network.defaultEgress).toBe("allow");
    expect(merged.network.inherit).toBe(true);
    expect(merged.workdirTarget).toBe("/workspace");
  });

  test("identical inputs produce identical output (determinism)", () => {
    const layer: PartialConfig = {
      env: { A: "1" },
      mounts: {
        cache: { kind: "named", source: "v", target: "/cache" },
      },
      ports: {
        web: { hostPort: 8080 },
      },
      secrets: {
        K: { from: "ENV_K", hosts: ["api.example"] },
      },
      network: { allow: ["a:tcp:1", "b:tcp:2"] },
    };
    const a = mergeConfigs([layer]);
    const b = mergeConfigs([layer]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("scalar last-non-empty wins (empty overlay does not erase)", () => {
    const merged = mergeConfigs([
      { stock: { dockerDataSize: "20G" } },
      { stock: { dockerDataSize: "" } },
    ]);
    expect(merged.stock.dockerDataSize).toBe("20G");
  });

  test("custom image mode requires reference", () => {
    const merged = mergeConfigs([
      { stock: { imageMode: "custom", customImage: "my-project:v2", dockerDataSize: "30G" } },
    ]);
    expect(merged.stock.imageMode).toBe("custom");
    expect(merged.stock.customImage).toBe("my-project:v2");
    expect(merged.stock.dockerDataSize).toBe("30G");
  });

  test("stock mode discards customImage", () => {
    const merged = mergeConfigs([
      { stock: { imageMode: "stock", customImage: "", dockerDataSize: "10G" } },
    ]);
    expect(merged.stock.imageMode).toBe("stock");
    expect(merged.stock.customImage).toBeUndefined();
  });

  test("signing defaults to disabled", () => {
    const merged = mergeConfigs([]);
    expect(merged.signing).toEqual({ enabled: false });
  });

  test("signing: personal key + project enable merge by scalar replacement", () => {
    const merged = mergeConfigs([
      { signing: { key: "/home/op/.config/mise-msb/signing/id_ed25519_sandbox" } },
      { signing: { enabled: true } },
    ]);
    expect(merged.signing.enabled).toBe(true);
    expect(merged.signing.key).toBe("/home/op/.config/mise-msb/signing/id_ed25519_sandbox");
  });

  test("signing: higher-precedence layer overrides the key path", () => {
    const merged = mergeConfigs([
      { signing: { enabled: true, key: "/personal/key" } },
      { signing: { key: "/project/key" } },
    ]);
    expect(merged.signing.enabled).toBe(true);
    expect(merged.signing.key).toBe("/project/key");
  });

  test("signing: key path expands a leading ~", () => {
    const merged = mergeConfigs([
      { signing: { key: "~/.config/mise-msb/signing/id_ed25519_sandbox" } },
    ]);
    expect(merged.signing.key).not.toContain("~");
    expect(merged.signing.key?.endsWith("/.config/mise-msb/signing/id_ed25519_sandbox")).toBe(true);
  });
});
