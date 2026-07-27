import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, chmodSync, existsSync, readlinkSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { installWrapper, defaultBinDir, pathContains, pathWarningMessage } from "../src/install/symlink.js";

describe("installWrapper", () => {
  let home: string;
  let binDir: string;
  let source: string;

  beforeEach(() => {
    home = join(tmpdir(), `mise-msb-install-${Date.now()}-${Math.random()}`);
    mkdirSync(home, { recursive: true });
    binDir = join(home, ".local", "bin");
    source = join(home, "mise-msb-source");
    writeFileSync(source, "#!/bin/sh\necho fake\n");
    chmodSync(source, 0o755);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  test("first install creates the symlink", () => {
    const result = installWrapper({ homeDir: home, binDir, sourcePath: source });
    expect(result.status).toBe("created");
    expect(result.target).toBe(source);
    expect(existsSync(join(binDir, "mise-msb"))).toBe(true);
    expect(readlinkSync(join(binDir, "mise-msb"))).toBe(source);
  });

  test("reinstall is a no-op when target matches", () => {
    installWrapper({ homeDir: home, binDir, sourcePath: source });
    const result = installWrapper({ homeDir: home, binDir, sourcePath: source });
    expect(result.status).toBe("unchanged");
  });

  test("collision without --force refuses and reports existing target", () => {
    installWrapper({ homeDir: home, binDir, sourcePath: source });
    const altSource = join(home, "alt-source");
    writeFileSync(altSource, "#!/bin/sh\necho alt\n");
    chmodSync(altSource, 0o755);
    const result = installWrapper({ homeDir: home, binDir, sourcePath: altSource });
    expect(result.status).toBe("refused");
    expect(result.existingTarget).toBe(source);
    // Existing symlink unchanged.
    expect(readlinkSync(join(binDir, "mise-msb"))).toBe(source);
  });

  test("collision with --force replaces", () => {
    installWrapper({ homeDir: home, binDir, sourcePath: source });
    const altSource = join(home, "alt-source");
    writeFileSync(altSource, "#!/bin/sh\necho alt\n");
    chmodSync(altSource, 0o755);
    const result = installWrapper({
      homeDir: home,
      binDir,
      sourcePath: altSource,
      force: true,
    });
    expect(result.status).toBe("replaced");
    expect(result.target).toBe(altSource);
    expect(readlinkSync(join(binDir, "mise-msb"))).toBe(altSource);
  });

  test("directory at destination is refused even with --force", () => {
    installWrapper({ homeDir: home, binDir, sourcePath: source });
    // Replace symlink with a directory of the same name.
    rmSync(join(binDir, "mise-msb"));
    mkdirSync(join(binDir, "mise-msb"));
    const result = installWrapper({ homeDir: home, binDir, sourcePath: source, force: true });
    expect(result.status).toBe("refused");
    expect(statSync(join(binDir, "mise-msb")).isDirectory()).toBe(true);
  });

  test("regular file at destination is replaced with --force", () => {
    const filePath = join(binDir, "mise-msb");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(filePath, "not a symlink");
    const result = installWrapper({ homeDir: home, binDir, sourcePath: source, force: true });
    expect(result.status).toBe("replaced");
    expect(readlinkSync(filePath)).toBe(source);
  });

  test("creates binDir when absent", () => {
    const nested = join(home, "fresh", ".local", "bin");
    expect(existsSync(nested)).toBe(false);
    const result = installWrapper({ homeDir: home, binDir: nested, sourcePath: source });
    expect(result.status).toBe("created");
    expect(existsSync(nested)).toBe(true);
  });
});

describe("pathContains", () => {
  test("detects directory in PATH", () => {
    expect(pathContains("/foo/bar", { PATH: "/foo:/foo/bar:/baz" })).toBe(true);
  });
  test("returns false when absent", () => {
    expect(pathContains("/foo/bar", { PATH: "/foo:/baz" })).toBe(false);
  });
  test("returns false when PATH unset", () => {
    expect(pathContains("/foo/bar", {})).toBe(false);
  });
});

describe("defaultBinDir", () => {
  test("uses ~/.local/bin", () => {
    expect(defaultBinDir("/home/u")).toBe("/home/u/.local/bin");
  });
});

describe("pathWarningMessage", () => {
  test("renders a friendly hint with ~ for the home prefix", () => {
    const msg = pathWarningMessage(`${homedir()}/.local/bin`);
    expect(msg).toContain("~/.local/bin");
    expect(msg).toContain("export PATH=");
  });
  test("falls back to absolute path when binDir is outside home", () => {
    const msg = pathWarningMessage("/opt/mise-msb/bin");
    expect(msg).toContain("/opt/mise-msb/bin");
  });
});
