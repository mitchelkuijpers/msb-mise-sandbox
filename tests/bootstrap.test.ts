import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configurePersonalBootstrap,
  discoverPersonalBootstrap,
  hashBootstrapDir,
  PERSONAL_BOOTSTRAP_MOUNT_NAME,
  personalBootstrapDir,
} from "../src/bootstrap/discovery.js";
import { mergeConfigs } from "../src/config/merge.js";

describe("personalBootstrapDir", () => {
  test("uses XDG_CONFIG_HOME when set", () => {
    const prev = process.env["XDG_CONFIG_HOME"];
    process.env["XDG_CONFIG_HOME"] = "/tmp/xdg-cfg";
    try {
      expect(personalBootstrapDir("/home/u")).toBe("/tmp/xdg-cfg/mise-msb/bootstrap");
    } finally {
      if (prev === undefined) delete process.env["XDG_CONFIG_HOME"];
      else process.env["XDG_CONFIG_HOME"] = prev;
    }
  });

  test("falls back to ~/.config", () => {
    expect(personalBootstrapDir("/home/u")).toBe("/home/u/.config/mise-msb/bootstrap");
  });
});

describe("discoverPersonalBootstrap", () => {
  test("returns null when no bootstrap file exists", () => {
    const dir = join(tmpdir(), `no-bootstrap-${Date.now()}`);
    expect(discoverPersonalBootstrap(dir)).toBeNull();
  });

  test("finds bootstrap when mise.toml exists", () => {
    const home = join(tmpdir(), `bootstrap-present-${Date.now()}`);
    const bootstrapDir = join(home, ".config", "mise-msb", "bootstrap");
    mkdirSync(bootstrapDir, { recursive: true });
    writeFileSync(join(bootstrapDir, "mise.toml"), '[tools]\nripgrep = "latest"\n');
    const result = discoverPersonalBootstrap(home);
    expect(result).not.toBeNull();
    expect(result!.dir).toBe(bootstrapDir);
    expect(result!.miseTomlPath).toBe(join(bootstrapDir, "mise.toml"));
    rmSync(home, { recursive: true, force: true });
  });
});

describe("configurePersonalBootstrap", () => {
  test("adds the read-only mount and global mise config in stock mode", () => {
    const home = join(tmpdir(), `bootstrap-config-${Date.now()}`);
    const bootstrapDir = join(home, ".config", "mise-msb", "bootstrap");
    mkdirSync(bootstrapDir, { recursive: true });
    writeFileSync(join(bootstrapDir, "mise.toml"), '[tools]\nripgrep = "latest"\n');

    const config = mergeConfigs([]);
    configurePersonalBootstrap(config, home);

    expect(config.mounts[PERSONAL_BOOTSTRAP_MOUNT_NAME]).toEqual({
      kind: "dir",
      source: bootstrapDir,
      target: "/etc/mise-msb/personal",
      options: "ro",
    });
    expect(config.env["MISE_GLOBAL_CONFIG_FILE"]).toBe(
      "/etc/mise-msb/personal/mise.toml",
    );
    rmSync(home, { recursive: true, force: true });
  });

  test("does not add personal bootstrap to custom images", () => {
    const config = mergeConfigs([
      { stock: { imageMode: "custom", customImage: "custom:v1" } },
    ]);
    expect(configurePersonalBootstrap(config, "/nonexistent")).toBeNull();
    expect(config.mounts[PERSONAL_BOOTSTRAP_MOUNT_NAME]).toBeUndefined();
  });
});

describe("hashBootstrapDir", () => {
  test("produces stable hash for identical content", () => {
    const dir = join(tmpdir(), `hash-stable-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mise.toml"), '[tools]\nripgrep = "latest"\n');
    writeFileSync(join(dir, "packages.txt"), "fzf\n");
    const hash1 = hashBootstrapDir(dir);
    const hash2 = hashBootstrapDir(dir);
    expect(hash1).toBe(hash2);
    rmSync(dir, { recursive: true, force: true });
  });

  test("produces different hash for changed content", () => {
    const dir = join(tmpdir(), `hash-change-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mise.toml"), '[tools]\nripgrep = "latest"\n');
    const hash1 = hashBootstrapDir(dir);
    writeFileSync(join(dir, "mise.toml"), '[tools]\nripgrep = "1.0"\n');
    const hash2 = hashBootstrapDir(dir);
    expect(hash1).not.toBe(hash2);
    rmSync(dir, { recursive: true, force: true });
  });

  test("produces different hash for added file", () => {
    const dir = join(tmpdir(), `hash-add-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mise.toml"), '[tools]\nripgrep = "latest"\n');
    const hash1 = hashBootstrapDir(dir);
    writeFileSync(join(dir, "packages.txt"), "fzf\n");
    const hash2 = hashBootstrapDir(dir);
    expect(hash1).not.toBe(hash2);
    rmSync(dir, { recursive: true, force: true });
  });

  test("handles missing directory gracefully", () => {
    const dir = join(tmpdir(), `hash-missing-${Date.now()}`);
    const hash = hashBootstrapDir(dir);
    expect(hash.length).toBe(64); // SHA256 hex
  });
});
