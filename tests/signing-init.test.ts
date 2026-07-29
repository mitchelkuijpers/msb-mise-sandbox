import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";
import { signingInit, SIGNING_KEY_COMMENT } from "../src/commands/signing.js";
import { SIGNING_KEY_NAME, signingDir } from "../src/signing/paths.js";

let home: string;
let lines: string[];
const out = (line: string) => { lines.push(line); };

beforeEach(() => {
  home = join(tmpdir(), `mise-msb-signing-init-${Date.now()}-${Math.random()}`);
  mkdirSync(home, { recursive: true });
  lines = [];
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("signing init", () => {
  test("first init creates the keypair with correct names, perms, and comment", () => {
    const result = signingInit(false, { homeDir: home, out });
    const dir = signingDir(home);
    expect(result.status).toBe("created");
    expect(result.keyPath).toBe(join(dir, SIGNING_KEY_NAME));
    expect(existsSync(result.keyPath)).toBe(true);
    expect(existsSync(result.pubPath)).toBe(true);
    expect(mode(dir)).toBe(0o700);
    expect(mode(result.keyPath)).toBe(0o600);
    expect(mode(result.pubPath)).toBe(0o644);
    const pub = readFileSync(result.pubPath, "utf8");
    expect(pub).toContain("ssh-ed25519");
    expect(pub).toContain(SIGNING_KEY_COMMENT);
    // Output includes forge instructions and an allowed_signers line.
    const text = lines.join("\n");
    expect(text).toContain("Signing Key");
    expect(text).toContain(pub.trim());
  });

  test("re-init is a no-op and reports the existing path", () => {
    const first = signingInit(false, { homeDir: home, out });
    const pubBefore = readFileSync(first.pubPath, "utf8");
    const second = signingInit(false, { homeDir: home, out });
    expect(second.status).toBe("exists");
    expect(readFileSync(second.pubPath, "utf8")).toBe(pubBefore);
    expect(lines.join("\n")).toContain("already exists");
  });

  test("--force regenerates the keypair and prints the forge-removal reminder", () => {
    const first = signingInit(false, { homeDir: home, out });
    const pubBefore = readFileSync(first.pubPath, "utf8");
    const second = signingInit(true, { homeDir: home, out });
    expect(second.status).toBe("regenerated");
    expect(readFileSync(second.pubPath, "utf8")).not.toBe(pubBefore);
    expect(lines.join("\n")).toContain("remove the OLD key from your forge");
  });
});
