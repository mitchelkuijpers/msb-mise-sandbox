import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * ssh-proxy behavior tests.
 *
 * The proxy calls process.exit() on completion, so behavior is observed by
 * spawning the real CLI entry (`src/mise-msb.ts`) as a subprocess with a
 * fake `msb` on PATH that records its argv and/or mirrors streams. This
 * exercises argv delegation, stream transparency, and exit propagation
 * end to end without mocking process.exit.
 */
describe("ssh-proxy command", () => {
  let binDir: string;
  let fakeMsb: string;
  let recordPath: string;
  let originalPath: string | undefined;
  let extraTmpDirs: string[];

  beforeEach(() => {
    binDir = join(tmpdir(), `mise-msb-ssh-proxy-${Date.now()}-${Math.random()}`);
    mkdirSync(binDir, { recursive: true });
    fakeMsb = join(binDir, "msb");
    recordPath = join(binDir, "record.log");
    originalPath = process.env["PATH"];
    process.env["PATH"] = `${binDir}:${originalPath ?? ""}`;
    extraTmpDirs = [];
  });

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = originalPath;
    }
    for (const dir of extraTmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    rmSync(binDir, { recursive: true, force: true });
  });

  function writeFakeMsb(script: string): void {
    writeFileSync(fakeMsb, script);
    chmodSync(fakeMsb, 0o755);
  }

  /** Fake `msb` that appends its argv, one argument per line, to the record file. */
  function recordScript(): string {
    return `#!/bin/sh
printf '%s\\n' "$@" >> '${recordPath}'
`;
  }

  function cliEnv(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      ...process.env,
      ...overrides,
      PATH: overrides["PATH"] ?? `${binDir}:${originalPath ?? ""}`,
    };
  }

  function runCli(
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
    } = {},
  ) {
    return Bun.spawnSync({
      cmd: [process.execPath, join(import.meta.dir, "..", "src", "mise-msb.ts"), ...args],
      cwd: options.cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: cliEnv(options.env),
    });
  }

  function recordedArgv(): string[] {
    return readFileSync(recordPath, "utf8").trim().split("\n");
  }

  test("routes a valid .msb alias to msb ssh serve <name> --stdio", () => {
    writeFakeMsb(recordScript());
    const result = runCli(["ssh-proxy", "agent-sandbox.msb"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("");
    // Exactly the canonical argv, nothing else appended.
    expect(recordedArgv().join(" ")).toBe("ssh serve agent-sandbox --stdio");
  });

  test("routes a raw msb sandbox name without config discovery", () => {
    writeFakeMsb(recordScript());
    // Fresh directory with no .sandbox.toml: routing must not consult
    // project configuration or a wrapper-owned registry.
    const rawDir = mkdtempSync(join(tmpdir(), "mise-msb-raw-"));
    extraTmpDirs.push(rawDir);

    const result = runCli(["ssh-proxy", "otherbox.msb"], { cwd: rawDir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("");
    expect(recordedArgv().join(" ")).toBe("ssh serve otherbox --stdio");
  });

  test("rejects a missing alias before starting msb", () => {
    writeFakeMsb(recordScript());
    const result = runCli(["ssh-proxy"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toMatch(/alias/i);
    expect(existsSync(recordPath)).toBe(false);
  });

  test("rejects an extra positional argument", () => {
    writeFakeMsb(recordScript());
    const result = runCli(["ssh-proxy", "a.msb", "b.msb"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toMatch(/argument|alias/i);
    expect(existsSync(recordPath)).toBe(false);
  });

  test("rejects an alias without the .msb suffix", () => {
    writeFakeMsb(recordScript());
    const result = runCli(["ssh-proxy", "agent-sandbox"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toMatch(/\.msb|suffix/i);
    expect(existsSync(recordPath)).toBe(false);
  });

  test("rejects an empty sandbox name (.msb)", () => {
    writeFakeMsb(recordScript());
    const result = runCli(["ssh-proxy", ".msb"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toMatch(/name|empty/i);
    expect(existsSync(recordPath)).toBe(false);
  });

  test("rejects a sandbox name with invalid characters", () => {
    writeFakeMsb(recordScript());
    const result = runCli(["ssh-proxy", "Bad_Name.msb"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toMatch(/name|invalid|syntax/i);
    expect(existsSync(recordPath)).toBe(false);
  });

  test("rejects an uppercase sandbox name", () => {
    writeFakeMsb(recordScript());
    const result = runCli(["ssh-proxy", "UPPER.msb"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toMatch(/name|invalid|syntax/i);
    expect(existsSync(recordPath)).toBe(false);
  });

  test("streams stdin/stdout bytes transparently and keeps stdout clean", async () => {
    writeFakeMsb(`#!/bin/sh
printf 'err-marker\\n' >&2
cat
`);
    const payload = Buffer.from("ssh-proto-bytes\x00\x01", "latin1");
    const proc = Bun.spawn({
      cmd: [process.execPath, "src/mise-msb.ts", "ssh-proxy", "agent-sandbox.msb"],
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: cliEnv(),
    });
    proc.stdin!.write(payload);
    proc.stdin!.end();

    const exitCode = await proc.exited;
    const stdout = Buffer.from(await Bun.readableStreamToArrayBuffer(proc.stdout));
    const stderr = Buffer.from(await Bun.readableStreamToArrayBuffer(proc.stderr));

    expect(exitCode).toBe(0);
    // Exact byte equality: no banner, prefix, suffix, or newline added by
    // the wrapper on the protocol stream.
    expect(stdout.equals(payload)).toBe(true);
    // The child's stderr marker passes through untouched as well.
    expect(stderr.toString()).toContain("err-marker");
  });

  test("propagates a non-zero child exit code", () => {
    writeFakeMsb("#!/bin/sh\nexit 3\n");
    const result = runCli(["ssh-proxy", "agent-sandbox.msb"]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout.toString()).toBe("");
  });

  test("fails when msb is missing from PATH", () => {
    // Point PATH at an empty directory so the host environment cannot
    // accidentally supply a real `msb`.
    const emptyDir = mkdtempSync(join(tmpdir(), "mise-msb-nopath-"));
    extraTmpDirs.push(emptyDir);

    const result = runCli(["ssh-proxy", "agent-sandbox.msb"], { env: { PATH: emptyDir } });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).not.toBe("");
  });

  test("--help lists the ssh-proxy and ssh-config commands", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "src/mise-msb.ts", "--help"],
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain("  ssh-proxy");
    expect(output).toContain("  ssh-config");
    // Pin the descriptive usage lines from the change contract.
    expect(output).toContain("Adapt a .msb SSH alias to the raw msb stdio transport");
    expect(output).toContain("Print the reusable Host *.msb OpenSSH block");
  });
});
