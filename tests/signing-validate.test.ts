import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SigningValidationError,
  validateSigningKey,
} from "../src/signing/validate.js";
import { GUEST_KEY_PATH, GUEST_PUBKEY_PATH, signingDir } from "../src/signing/paths.js";
import type { SandboxConfig } from "../src/config/types.js";
import { buildCreateArgv } from "../src/msb/argv.js";

let home: string;
let dir: string; // wrapper-owned signing dir under the fake home

function makeConfig(key: string | undefined, enabled = true): SandboxConfig {
  return {
    identity: { name: "p", workdir: "/workspace" },
    stock: { imageMode: "stock", dockerDataSize: "10G" },
    runtime: { cpus: 4, memory: "8G" },
    workdirTarget: "/workspace",
    mounts: {},
    ports: {},
    network: { defaultEgress: "allow", allow: [], inherit: true },
    env: {},
    secrets: {},
    labels: {},
    signing: { enabled, key },
  };
}

function genKey(path: string, passphrase = ""): void {
  const proc = Bun.spawnSync({
    cmd: ["ssh-keygen", "-t", "ed25519", "-N", passphrase, "-C", "test-fixture", "-f", path],
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (proc.exitCode !== 0) {
    throw new Error(`fixture keygen failed: ${proc.stderr.toString()}`);
  }
  chmodSync(path, 0o600);
  chmodSync(`${path}.pub`, 0o644);
}

beforeEach(() => {
  home = join(tmpdir(), `mise-msb-signing-${Date.now()}-${Math.random()}`);
  dir = signingDir(home);
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("validateSigningKey", () => {
  test("valid keypair in the signing directory passes", () => {
    const key = join(dir, "id_ed25519_sandbox");
    genKey(key);
    expect(() => validateSigningKey(makeConfig(key), home)).not.toThrow();
  });

  test("disabled signing skips all key-file checks", () => {
    expect(() =>
      validateSigningKey(makeConfig("/nonexistent/key", false), home),
    ).not.toThrow();
  });

  test("enabled without a key fails naming signing init", () => {
    expect(() => validateSigningKey(makeConfig(undefined), home)).toThrow(/signing init/);
  });

  test("key outside the signing directory fails the location invariant", () => {
    const outside = join(home, "id_ed25519");
    genKey(outside);
    expect(() => validateSigningKey(makeConfig(outside), home)).toThrow(
      /outside the wrapper-owned signing directory/,
    );
  });

  test("symlink inside the signing dir resolving outside is rejected", () => {
    const outside = join(home, "real-key");
    genKey(outside);
    const link = join(dir, "id_ed25519_sandbox");
    symlinkSync(outside, link);
    symlinkSync(`${outside}.pub`, `${link}.pub`);
    expect(() => validateSigningKey(makeConfig(link), home)).toThrow(SigningValidationError);
    try {
      validateSigningKey(makeConfig(link), home);
      expect.unreachable();
    } catch (err) {
      expect((err as SigningValidationError).check).toBe("location");
    }
  });

  test("world-readable key fails naming the chmod remedy", () => {
    const key = join(dir, "id_ed25519_sandbox");
    genKey(key);
    chmodSync(key, 0o644);
    expect(() => validateSigningKey(makeConfig(key), home)).toThrow(/chmod 600/);
  });

  test("encrypted key fails naming signing init as the fix", () => {
    const key = join(dir, "id_ed25519_sandbox");
    genKey(key, "hunter2");
    chmodSync(key, 0o600);
    expect(() => validateSigningKey(makeConfig(key), home)).toThrow(/passphrase/);
  });

  test("key with execute bits fails with the chmod remedy", () => {
    const key = join(dir, "id_ed25519_sandbox");
    genKey(key);
    chmodSync(key, 0o700);
    expect(() => validateSigningKey(makeConfig(key), home)).toThrow(/0600/);
  });

  test("key with stricter permissions 0400 succeeds", () => {
    const key = join(dir, "id_ed25519_sandbox");
    genKey(key);
    chmodSync(key, 0o400);
    expect(() => validateSigningKey(makeConfig(key), home)).not.toThrow();
  });

  test("mismatched .pub fails naming the mismatch", () => {
    const key = join(dir, "id_ed25519_sandbox");
    genKey(key);
    chmodSync(key, 0o600);
    const other = join(dir, "other");
    genKey(other);
    // Overwrite the sibling .pub with the other key's public key.
    copyFileSync(`${other}.pub`, `${key}.pub`);
    expect(() => validateSigningKey(makeConfig(key), home)).toThrow(/does not match/);
  });

  test("missing .pub fails", () => {
    const key = join(dir, "id_ed25519_sandbox");
    genKey(key);
    chmodSync(key, 0o600);
    rmSync(`${key}.pub`);
    expect(() => validateSigningKey(makeConfig(key), home)).toThrow(/public key .* is missing/);
  });

  test("nonexistent key fails naming signing init", () => {
    const key = join(dir, "id_ed25519_sandbox");
    expect(() => validateSigningKey(makeConfig(key), home)).toThrow(/does not exist/);
  });

  test("ssh-keygen binary not found produces actionable error", () => {
    const keyPath = join(dir, "id_ed25519_sandbox");
    genKey(keyPath);

    const testExe = "/definitely/missing/ssh-keygen";
    let caughtError: unknown;
    try {
      validateSigningKey(makeConfig(keyPath), home, { sshKeygenPath: testExe });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(SigningValidationError);
    const validationError = caughtError as SigningValidationError;
    expect(validationError.check).toBe("ssh-keygen");
    expect(validationError.message).toMatch(/ssh-keygen/);
    expect(validationError.message).toMatch(/install|PATH|executable/);
    expect(validationError.message).toContain(testExe);
  });

  test("in-directory symlink to valid keypair emits canonical paths via argv", () => {
    const realKey = join(dir, "id_ed25519_real");
    const linkKey = join(dir, "id_ed25519_sandbox");
    genKey(realKey);
    symlinkSync(realKey, linkKey);

    const config = makeConfig(linkKey, true);
    const validated = validateSigningKey(config, home)!;
    const canonicalKey = realpathSync(realKey);
    const canonicalPub = realpathSync(`${realKey}.pub`);
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config,
      signingKey: validated,
    });

    expect(validated).toEqual({
      privateKeyPath: canonicalKey,
      publicKeyPath: canonicalPub,
    });
    expect(argv).toContain(`${canonicalKey}:${GUEST_KEY_PATH}:ro`);
    expect(argv).toContain(`${canonicalPub}:${GUEST_PUBKEY_PATH}:ro`);
    expect(argv.join(" ")).not.toContain(`${linkKey}.pub`);
  });
});
