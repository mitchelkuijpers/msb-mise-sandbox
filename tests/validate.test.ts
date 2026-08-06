import { describe, expect, test } from "bun:test";
import { validateLayers, validateMerged, validatePartial } from "../src/config/validate.js";
import { mergeConfigs } from "../src/config/merge.js";
import { loadConfig } from "../src/config/index.js";
import type { PartialConfig, SandboxConfig } from "../src/config/types.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("validatePartial", () => {
  test("rejects unknown keys under [runtime]", () => {
    for (const key of ["memroy", "diskSize"]) {
      expect(() =>
        validatePartial({ runtime: { [key]: "8G" } } as unknown as PartialConfig),
      ).toThrow(/runtime\.(memroy|diskSize)|unknown/);
    }
  });

  test("rejects non-integer cpus", () => {
    expect(() => validatePartial({ runtime: { cpus: 1.5 } })).toThrow(/runtime\.cpus/);
  });

  test("rejects invalid memory format", () => {
    expect(() => validatePartial({ runtime: { memory: "8X" } })).toThrow(/runtime\.memory/);
  });

  test("accepts valid rootDisk sizes", () => {
    expect(() => validatePartial({ runtime: { rootDisk: "512M" } })).not.toThrow();
    expect(() => validatePartial({ runtime: { rootDisk: "8G" } })).not.toThrow();
  });

  test("rejects malformed rootDisk sizes", () => {
    for (const rootDisk of ["8GB", "8", "abc"]) {
      expect(() => validatePartial({ runtime: { rootDisk } })).toThrow(/runtime\.rootDisk/);
    }
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

  test("accepts a secret entry whose key matches its `from`", () => {
    expect(() =>
      validatePartial({
        secrets: {
          OPENAI_API_KEY: { from: "OPENAI_API_KEY", hosts: ["api.openai.com"] },
        },
      }),
    ).not.toThrow();
  });

  test("accepts a secret entry whose key differs from its `from`", () => {
    expect(() =>
      validatePartial({
        secrets: {
          OPENCODE_API_KEY: {
            from: "OPENCODE_API_KEY_PERSONAL",
            hosts: ["opencode.ai"],
          },
        },
      }),
    ).not.toThrow();
  });

  test("rejects decorative secret keys that are not env names", () => {
    expect(() =>
      validatePartial({
        secrets: {
          "personal-github-token": {
            from: "GITHUB_TOKEN",
            hosts: ["github.com"],
          },
        },
      }),
    ).toThrow(/secrets\.personal-github-token/);
  });

  test("rejects secret keys starting with a digit", () => {
    expect(() =>
      validatePartial({
        secrets: { "1BAD": { from: "FOO", hosts: ["x"] } },
      }),
    ).toThrow(/secrets\.1BAD/);
  });

  test("still rejects an invalid `from` source independently of the key", () => {
    expect(() =>
      validatePartial({
        secrets: {
          OPENCODE_API_KEY: {
            from: "opencode-api-key-personal",
            hosts: ["opencode.ai"],
          },
        },
      }),
    ).toThrow(/secrets\.OPENCODE_API_KEY\.from/);
  });

  test("rejects unknown keys under [signing]", () => {
    expect(() =>
      validatePartial({ signing: { bits: 256 } as unknown as { enabled?: boolean; key?: string } }, "cfg.toml"),
    ).toThrow(/cfg\.toml.*signing\.bits|unknown signing key/);
  });

  test("rejects non-boolean signing.enabled", () => {
    expect(() =>
      validatePartial({ signing: { enabled: "yes" } as unknown as { enabled?: boolean } }),
    ).toThrow(/signing\.enabled/);
  });

  test("rejects empty signing.key", () => {
    expect(() => validatePartial({ signing: { key: "" } })).toThrow(/signing\.key/);
  });

  test("accepts a well-formed [signing] table", () => {
    expect(() =>
      validatePartial({ signing: { enabled: true, key: "~/.config/mise-msb/signing/id_ed25519_sandbox" } }),
    ).not.toThrow();
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
  test("rejects an invalid secret table key", () => {
    const merged: SandboxConfig = {
      identity: { name: "p", workdir: "/workspace" },
      stock: { imageMode: "stock", dockerDataSize: "10G" },
      runtime: { cpus: 4, memory: "8G", rootDisk: "8G" },
      workdirTarget: "/workspace",
      mounts: {},
      ports: {},
      network: { defaultEgress: "allow", allow: [], inherit: true },
      env: {},
      secrets: {
        "bad-name": { from: "BAD_NAME", hosts: ["x.example"] },
      },
      labels: {},
      signing: { enabled: false },
    };
    expect(() => validateMerged(merged)).toThrow(/secrets\.bad-name/);
  });

  test("rejects invalid docker data size", () => {
    const merged: SandboxConfig = {
      identity: { name: "p", workdir: "/workspace" },
      stock: { imageMode: "stock", dockerDataSize: "invalid" as unknown as `${number}${"M" | "G"}` },
      runtime: { cpus: 4, memory: "8G", rootDisk: "8G" },
      workdirTarget: "/workspace",
      mounts: {},
      ports: {},
      network: { defaultEgress: "allow", allow: [], inherit: true },
      env: {},
      secrets: {},
      labels: {},
      signing: { enabled: false },
    };
    expect(() => validateMerged(merged)).toThrow(/stock\.dockerDataSize/);
  });

  test("rejects invalid runtime rootDisk", () => {
    const merged: SandboxConfig = {
      identity: { name: "p", workdir: "/workspace" },
      stock: { imageMode: "stock", dockerDataSize: "10G" },
      runtime: {
        cpus: 4,
        memory: "8G",
        rootDisk: "invalid" as unknown as `${number}${"M" | "G"}`,
      },
      workdirTarget: "/workspace",
      mounts: {},
      ports: {},
      network: { defaultEgress: "allow", allow: [], inherit: true },
      env: {},
      secrets: {},
      labels: {},
      signing: { enabled: false },
    };
    expect(() => validateMerged(merged)).toThrow(/runtime\.rootDisk/);
  });

  test("stock mode rejects mounts targeting reserved stock paths", () => {
    for (const target of ["/mise", "/var/lib/docker"]) {
      const merged = mergeConfigs([
        { identity: { name: "p" }, mounts: { data: { kind: "named", source: "data", target } } },
      ]);
      expect(() => validateMerged(merged)).toThrow(
        new RegExp(`mounts\\.data\\.target.*${target.replace(/\//g, "\\/")}`),
      );
    }
  });

  test("custom image mode allows mounts at stock-reserved paths", () => {
    const merged = mergeConfigs([
      {
        identity: { name: "p" },
        stock: { imageMode: "custom", customImage: "p:dev" },
        mounts: { data: { kind: "named", source: "data", target: "/var/lib/docker" } },
      },
    ]);
    expect(() => validateMerged(merged)).not.toThrow();
  });
});

describe("integration with mergeConfigs", () => {
  test("merge + validate end-to-end", () => {
    const merged = mergeConfigs([
      { runtime: { cpus: 6, memory: "16G" } },
      { env: { NODE_ENV: "production" } },
      { network: { defaultEgress: "deny", allow: ["github.com:tcp:443"] } },
      { stock: { imageMode: "custom", customImage: "my-project:dev", dockerDataSize: "20G" } },
    ]);
    merged.identity.name = "p";
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
    expect(config.stock.imageMode).toBe("stock");
    rmSync(dir, { recursive: true, force: true });
  });

  test("missing optional files do not fail", async () => {
    const dir = makeTmp("e2e-empty");
    const { config } = await loadConfig({ cwd: dir, homeDir: "/nonexistent" });
    expect(config.runtime.cpus).toBe(4);
    rmSync(dir, { recursive: true, force: true });
  });

  test("disabled signing with a nonexistent key loads without key-file checks", async () => {
    const dir = makeTmp("e2e-signing-off");
    writeFileSync(
      join(dir, ".sandbox.toml"),
      '[signing]\nkey = "/nonexistent/id_ed25519_sandbox"\n',
    );
    const { config } = await loadConfig({ cwd: dir, homeDir: "/nonexistent" });
    expect(config.signing.enabled).toBe(false);
    expect(config.signing.key).toBe("/nonexistent/id_ed25519_sandbox");
    rmSync(dir, { recursive: true, force: true });
  });
});

function makeTmp(label: string): string {
  const dir = join(tmpdir(), `mise-msb-${label}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
