import { describe, expect, test } from "bun:test";
import { dispatch } from "../src/commands/dispatch.js";

const REMOVED_COMMANDS = [
  "run",
  "shell",
  "exec",
  "start",
  "stop",
  "remove",
  "rm",
  "list",
  "ls",
] as const;

describe("reduced CLI command surface", () => {
  for (const command of REMOVED_COMMANDS) {
    test(`${command} is rejected before any sandbox operation`, async () => {
      try {
        await dispatch([command]);
        throw new Error(`expected ${command} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(`unknown command: ${command}`);
      }
    });
  }

  test("help lists only supported commands", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "src/mise-msb.ts", "--help"],
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    for (const command of ["setup", "create", "config", "signing", "install"]) {
      expect(output).toContain(`  ${command}`);
    }
    for (const command of REMOVED_COMMANDS) {
      expect(output).not.toContain(`  ${command}`);
    }
  });
});
