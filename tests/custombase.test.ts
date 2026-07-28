import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareCalVer,
  discoverPersonalContainerfile,
  meetsMinimum,
  MIN_MISE_VERSION,
  parseMiseVersion,
  personalContainerfilePath,
} from "../src/build/custombase.js";
import { personalImageDirPath } from "../src/config/loader.js";

// ---------------------------------------------------------------------------
// Discovery (1.1)
// ---------------------------------------------------------------------------

describe("personal Containerfile discovery", () => {
  let home: string;
  let originalXdg: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "msb-home-"));
    originalXdg = process.env["XDG_CONFIG_HOME"];
    delete process.env["XDG_CONFIG_HOME"];
  });

  afterEach(() => {
    if (originalXdg === undefined) {
      delete process.env["XDG_CONFIG_HOME"];
    } else {
      process.env["XDG_CONFIG_HOME"] = originalXdg;
    }
    rmSync(home, { recursive: true, force: true });
  });

  test("returns null when the Containerfile is absent", () => {
    expect(discoverPersonalContainerfile(home)).toBeNull();
  });

  test("discovers the Containerfile and resolves its containing directory as the context", () => {
    const imageDir = join(home, ".config", "mise-msb", "image");
    mkdirSync(imageDir, { recursive: true });
    writeFileSync(join(imageDir, "Containerfile"), "FROM ubuntu:24.04\n");

    const result = discoverPersonalContainerfile(home);
    expect(result).not.toBeNull();
    expect(result?.containerfile).toBe(join(imageDir, "Containerfile"));
    expect(result?.contextDir).toBe(imageDir);
  });

  test("personalContainerfilePath and personalImageDirPath resolve under homeDir", () => {
    expect(personalImageDirPath(home)).toBe(join(home, ".config", "mise-msb", "image"));
    expect(personalContainerfilePath(home)).toBe(
      join(home, ".config", "mise-msb", "image", "Containerfile"),
    );
  });

  test("isolated context excludes sibling config.toml", () => {
    const configDir = join(home, ".config", "mise-msb");
    mkdirSync(join(configDir, "image"), { recursive: true });
    writeFileSync(join(configDir, "image", "Containerfile"), "FROM ubuntu:24.04\n");
    writeFileSync(join(configDir, "config.toml"), "# personal\n");

    const result = discoverPersonalContainerfile(home);
    expect(result?.contextDir).toBe(join(configDir, "image"));
    expect(existsSync(join(result!.contextDir, "Containerfile"))).toBe(true);
    // config.toml is a sibling of image/, not inside the build context.
    expect(existsSync(join(result!.contextDir, "config.toml"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Calendar-version parsing and comparison (1.2)
// ---------------------------------------------------------------------------

describe("parseMiseVersion", () => {
  test("parses the leading calendar version from mise output", () => {
    const v = parseMiseVersion("mise 2026.7.12 linux-x64 (2026-07-12)\n");
    expect(v.major).toBe(2026);
    expect(v.minor).toBe(7);
    expect(v.patch).toBe(12);
    expect(v.raw).toBe("2026.7.12");
  });

  test("preserves raw output in the parse error", () => {
    expect(() => parseMiseVersion("mise abc\n")).toThrow(/mise abc/);
  });

  test("throws on empty output", () => {
    expect(() => parseMiseVersion("")).toThrow();
  });

  test("throws on output with no calendar version", () => {
    expect(() => parseMiseVersion("version unknown")).toThrow(/unknown/);
  });
});

describe("2026.7.12 minimum boundary", () => {
  test("exact minimum passes", () => {
    expect(meetsMinimum(parseMiseVersion("mise 2026.7.12"), MIN_MISE_VERSION)).toBe(true);
  });

  test("one patch below fails", () => {
    expect(meetsMinimum(parseMiseVersion("mise 2026.7.11"), MIN_MISE_VERSION)).toBe(false);
  });

  test("previous minor fails", () => {
    expect(meetsMinimum(parseMiseVersion("mise 2026.6.0"), MIN_MISE_VERSION)).toBe(false);
  });

  test("next minor passes", () => {
    expect(meetsMinimum(parseMiseVersion("mise 2026.8.0"), MIN_MISE_VERSION)).toBe(true);
  });

  test("next year passes", () => {
    expect(meetsMinimum(parseMiseVersion("mise 2027.1.1"), MIN_MISE_VERSION)).toBe(true);
  });

  test("zero-padded components parse correctly", () => {
    expect(meetsMinimum(parseMiseVersion("mise 2026.07.12"), MIN_MISE_VERSION)).toBe(true);
  });
});

describe("compareCalVer", () => {
  test("orders by major, then minor, then patch", () => {
    expect(compareCalVer(parseMiseVersion("mise 2026.7.12"), parseMiseVersion("mise 2026.7.11"))).toBeGreaterThan(0);
    expect(compareCalVer(parseMiseVersion("mise 2026.7.10"), parseMiseVersion("mise 2026.7.10"))).toBe(0);
    expect(compareCalVer(parseMiseVersion("mise 2026.7.9"), parseMiseVersion("mise 2026.7.10"))).toBeLessThan(0);
  });
});
