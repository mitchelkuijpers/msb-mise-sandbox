import { describe, expect, test } from "bun:test";
import { findProjectConfig, loadLayers, personalConfigPath } from "../src/config/loader.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `mise-msb-loader-${label}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("findProjectConfig", () => {
  test("finds .sandbox.toml in start directory", () => {
    const dir = makeTempDir("start");
    writeFileSync(join(dir, ".sandbox.toml"), "");
    expect(findProjectConfig(dir)).toBe(join(dir, ".sandbox.toml"));
    rmSync(dir, { recursive: true, force: true });
  });

  test("walks up to parent directory", () => {
    const dir = makeTempDir("walk");
    const child = join(dir, "a", "b");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(dir, ".sandbox.toml"), "");
    expect(findProjectConfig(child)).toBe(join(dir, ".sandbox.toml"));
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns null when no config exists", () => {
    const dir = makeTempDir("none");
    // Use a directory tree unlikely to contain a sandbox.toml
    expect(findProjectConfig(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("personalConfigPath", () => {
  test("uses XDG_CONFIG_HOME when set", () => {
    const prev = process.env["XDG_CONFIG_HOME"];
    process.env["XDG_CONFIG_HOME"] = "/tmp/xdg";
    try {
      expect(personalConfigPath("/home/u")).toBe("/tmp/xdg/mise-msb/config.toml");
    } finally {
      if (prev === undefined) {
        delete process.env["XDG_CONFIG_HOME"];
      } else {
        process.env["XDG_CONFIG_HOME"] = prev;
      }
    }
  });

  test("falls back to ~/.config/mise-msb/config.toml", () => {
    const prev = process.env["XDG_CONFIG_HOME"];
    delete process.env["XDG_CONFIG_HOME"];
    try {
      expect(personalConfigPath("/home/u")).toBe("/home/u/.config/mise-msb/config.toml");
    } finally {
      if (prev !== undefined) {
        process.env["XDG_CONFIG_HOME"] = prev;
      }
    }
  });
});

describe("loadLayers", () => {
  test("missing personal defaults are ignored", async () => {
    const dir = makeTempDir("missing-personal");
    const layers = await loadLayers({ cwd: dir, homeDir: "/nonexistent-home" });
    expect(layers).toHaveLength(1);
    expect(layers[0]?.config).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  test("malformed TOML throws with file path", async () => {
    const home = makeTempDir("bad-home");
    // The personal defaults file lives at $home/.config/mise-msb/config.toml.
    const cfgDir = join(home, ".config", "mise-msb");
    mkdirSync(cfgDir, { recursive: true });
    const cfg = join(cfgDir, "config.toml");
    // Unterminated basic string reliably triggers Bun.TOML.parse errors.
    writeFileSync(cfg, "key = \"unterminated");
    await expect(loadLayers({ homeDir: home })).rejects.toThrow(/config\.toml/);
    rmSync(home, { recursive: true, force: true });
  });

  test("explicit --config bypasses project discovery", async () => {
    const home = makeTempDir("explicit-home");
    const projDir = makeTempDir("explicit-proj");
    const explicitCfg = join(home, "explicit.toml");
    writeFileSync(explicitCfg, '[runtime]\ncpus = 9\n');
    // Place a project config at projDir that we should NOT find.
    writeFileSync(join(projDir, ".sandbox.toml"), '[runtime]\ncpus = 99\n');
    const layers = await loadLayers({ cwd: projDir, homeDir: home, configPath: explicitCfg });
    expect(layers).toHaveLength(2);
    expect(layers[1]?.source).toBe(explicitCfg);
    expect(layers[1]?.config?.runtime?.cpus).toBe(9);
    rmSync(home, { recursive: true, force: true });
    rmSync(projDir, { recursive: true, force: true });
  });
});
