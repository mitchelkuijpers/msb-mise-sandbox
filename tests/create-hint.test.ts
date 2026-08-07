/**
 * Tests for the Remote SSH hint printed by `mise-msb create`.
 *
 * Every test spawns the real CLI (`src/mise-msb.ts`) as a subprocess from a
 * throwaway project dir containing a minimal `.sandbox.toml`, with a fake
 * `msb` stub first on PATH (same trick as tests/lifecycle.test.ts, built via
 * explicit per-spawn env like tests/ssh-config.test.ts so the test process
 * environment is never mutated) and HOME/XDG_CONFIG_HOME redirected to
 * throwaway dirs so personal config discovery stays hermetic.
 */

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STOCK_IMAGE_TAG } from "../src/stock-image/constants.js";

const CLI = join(import.meta.dir, "..", "src", "mise-msb.ts");

/** Minimal custom-image config: skips the stock image preflight and all bootstrap stages. */
const CUSTOM_TOML = `[stock]
imageMode = "custom"
customImage = "my:v1"
`;

interface CreateResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Spawn the real CLI with the fake `msb` bin dir first on PATH. */
function runCreate(
  projectDir: string,
  env: Record<string, string>,
  ...args: string[]
): CreateResult {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, CLI, ...args],
    cwd: projectDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/** Base env with the fake bin dir prepended to PATH and a throwaway HOME. */
function spawnEnv(binDir: string, homeDir: string): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  env.PATH = `${binDir}:${env.PATH ?? ""}`;
  env.HOME = homeDir;
  // Keep personal config + personal bootstrap discovery inside the throwaway home.
  env.XDG_CONFIG_HOME = homeDir;
  return env;
}

describe("mise-msb create Remote SSH hint", () => {
  test("prints the Remote SSH hint after a successful create (custom mode)", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-proj-"));
    const homeDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-home-"));
    const binDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-bin-"));
    try {
      writeFileSync(join(projectDir, ".sandbox.toml"), CUSTOM_TOML);
      const fakeMsb = join(binDir, "msb");
      writeFileSync(fakeMsb, "#!/bin/sh\nexit 0\n");
      chmodSync(fakeMsb, 0o755);

      const name = "hintapp";
      const result = runCreate(projectDir, spawnEnv(binDir, homeDir), "create", name);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`ssh ${name}.msb`);
      expect(result.stdout).toContain("~/.ssh/config");
      expect(result.stdout).toContain("mise-msb ssh-config");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test("no hint when msb create fails (custom mode has no bootstrap stages)", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-proj-"));
    const homeDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-home-"));
    const binDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-bin-"));
    try {
      writeFileSync(join(projectDir, ".sandbox.toml"), CUSTOM_TOML);
      const fakeMsb = join(binDir, "msb");
      writeFileSync(fakeMsb, "#!/bin/sh\nexit 1\n");
      chmodSync(fakeMsb, 0o755);

      const result = runCreate(projectDir, spawnEnv(binDir, homeDir), "create", "hintfail");

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stdout).not.toContain("ssh-config");
      expect(result.stdout).not.toContain("Remote SSH");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test("no hint when a stock bootstrap stage fails", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-proj-"));
    const homeDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-home-"));
    const binDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-bin-"));
    try {
      // No `[stock]` section → stock image mode with built-in defaults.
      writeFileSync(join(projectDir, ".sandbox.toml"), "# stock mode defaults\n");
      const fakeMsb = join(binDir, "msb");
      writeFileSync(
        fakeMsb,
        [
          "#!/bin/sh",
          'case "$1" in',
          // Preflight: `msb image list` must report the stock tag as loaded.
          `  image) echo "${STOCK_IMAGE_TAG}" ;;`,
          "  create) exit 0 ;;",
          // First bootstrap stage (`msb exec <name> -- docker-up`) fails.
          "  exec) exit 1 ;;",
          "  *) exit 0 ;;",
          "esac",
          "",
        ].join("\n"),
      );
      chmodSync(fakeMsb, 0o755);

      const result = runCreate(projectDir, spawnEnv(binDir, homeDir), "create", "hintstock");

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stdout).not.toContain("ssh-config");
      expect(result.stdout).not.toContain("Remote SSH");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test("print mode shows the planned command but no hint", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-proj-"));
    const homeDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-home-"));
    const binDir = mkdtempSync(join(tmpdir(), "mise-msb-hint-bin-"));
    try {
      writeFileSync(join(projectDir, ".sandbox.toml"), CUSTOM_TOML);
      const fakeMsb = join(binDir, "msb");
      writeFileSync(fakeMsb, "#!/bin/sh\nexit 0\n");
      chmodSync(fakeMsb, 0o755);

      const result = runCreate(projectDir, spawnEnv(binDir, homeDir), "create", "hintprint", "--print");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("msb create");
      expect(result.stdout).toContain("my:v1");
      expect(result.stdout).not.toContain("ssh-config");
      expect(result.stdout).not.toContain("Remote SSH");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
