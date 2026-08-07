/**
 * Tests for `mise-msb ssh-config` — the deterministic OpenSSH config renderer.
 *
 * Every test spawns the real CLI (`src/mise-msb.ts`) with Bun, in a throwaway
 * cwd that never contains a `.sandbox.toml`, and with HOME pointed at another
 * throwaway dir so config discovery or writes have nowhere to leak.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "mise-msb.ts");

const EXPECTED_BLOCK = `Host *.msb
    User root
    ProxyCommand mise-msb ssh-proxy %n
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
`;

interface SshConfigResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runSshConfig(
  cwd: string,
  env: Record<string, string>,
  ...extra: string[]
): SshConfigResult {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, CLI, "ssh-config", ...extra],
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/** Base env with HOME redirected; optionally strips every PATH entry mentioning msb. */
function isolatedEnv(homeDir: string, stripMsbFromPath: boolean): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  env.HOME = homeDir;
  if (stripMsbFromPath) {
    env.PATH = (process.env.PATH ?? "")
      .split(":")
      .filter((entry) => !entry.toLowerCase().includes("msb"))
      .join(":");
  }
  return env;
}

/** Runs `body` with a fresh empty cwd and HOME tmp dir, cleaning both up after. */
function withTmpDirs(body: (cwd: string, home: string) => void): void {
  const cwd = mkdtempSync(join(tmpdir(), "mise-msb-ssh-config-cwd-"));
  const home = mkdtempSync(join(tmpdir(), "mise-msb-ssh-config-home-"));
  try {
    body(cwd, home);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

describe("mise-msb ssh-config", () => {
  test("prints exactly the Host *.msb block and nothing else", () => {
    withTmpDirs((cwd, home) => {
      const result = runSshConfig(cwd, isolatedEnv(home, false));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(EXPECTED_BLOCK);
      expect(result.stderr).toBe("");
    });
  });

  test("scopes the Host pattern to *.msb, never a bare Host *", () => {
    withTmpDirs((cwd, home) => {
      const result = runSshConfig(cwd, isolatedEnv(home, false));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Host *.msb");
      expect(/^Host \*$/m.test(result.stdout)).toBe(false);
    });
  });

  test("includes every required OpenSSH option", () => {
    withTmpDirs((cwd, home) => {
      const result = runSshConfig(cwd, isolatedEnv(home, false));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("ProxyCommand mise-msb ssh-proxy %n");
      expect(result.stdout).toContain("StrictHostKeyChecking no");
      expect(result.stdout).toContain("UserKnownHostsFile /dev/null");
      expect(result.stdout).toContain("User root");
    });
  });

  test("rejects positional arguments with usage guidance", () => {
    withTmpDirs((cwd, home) => {
      const result = runSshConfig(cwd, isolatedEnv(home, false), "foo");
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("ssh-config");
    });
  });

  test("creates no files in cwd or HOME and needs no msb on PATH", () => {
    withTmpDirs((cwd, home) => {
      const env = isolatedEnv(home, true);
      expect(env.PATH ?? "").not.toMatch(/msb/i);
      expect(readdirSync(cwd)).toEqual([]);
      expect(readdirSync(home)).toEqual([]);

      const result = runSshConfig(cwd, env);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(EXPECTED_BLOCK);
      // No `.sandbox.toml` anywhere in the cwd, no `msb` executable reachable,
      // yet the renderer succeeds: it touches neither disk nor subprocesses.
      expect(readdirSync(cwd)).toEqual([]);
      expect(readdirSync(home)).toEqual([]);
    });
  });
});
