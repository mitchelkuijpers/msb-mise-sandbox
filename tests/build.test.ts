import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOciImage, planMacOsBuilder, shouldUseDirectMise } from "../src/build/oci.js";
import { BUILTIN_DEFAULTS, type SandboxConfig } from "../src/config/types.js";

function baseConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    ...BUILTIN_DEFAULTS,
    identity: { name: "p", workdir: "/workspace" },
    build: { ...BUILTIN_DEFAULTS.build, tag: "p:dev", from: "ubuntu:24.04", builderImage: "ubuntu:24.04" },
    runtime: { cpus: 4, memory: "8G" },
    workdirTarget: "/workspace",
    mounts: {},
    ports: {},
    network: { defaultEgress: "allow", allow: [], inherit: true },
    env: {},
    secrets: {},
    labels: {},
    ...overrides,
  };
}

describe("shouldUseDirectMise", () => {
  test("linux uses direct mise", () => {
    expect(shouldUseDirectMise("linux")).toBe(true);
  });
  test("darwin does not use direct mise", () => {
    expect(shouldUseDirectMise("darwin")).toBe(false);
  });
});

describe("planMacOsBuilder", () => {
  test("includes read-only project mount and read-write output mount", () => {
    const plan = planMacOsBuilder({
      config: baseConfig(),
      projectRoot: "/host/proj",
      outputDir: "/host/out",
    });
    const all = [...plan.runArgv, ...plan.execArgv, ...plan.removeArgv].join(" ");
    expect(all).toContain("--mount-dir /host/proj:/workspace:ro");
    expect(all).toContain("--mount-dir /host/out:/out:rw");
    expect(all).toContain("MISE_EXPERIMENTAL=1");
    expect(all).toContain("mise oci build");
    expect(all).toContain("--from ubuntu:24.04");
    expect(all).toContain("--tag p:dev");
    // Uses detach + exec + remove pattern.
    expect(plan.runArgv.join(" ")).toContain("--detach");
    expect(plan.execArgv.join(" ")).toContain("msb exec");
    expect(plan.removeArgv.join(" ")).toContain("msb remove -f");
  });
});

describe("buildOciImage", () => {
  let workDir: string;
  let binDir: string;
  let fakeMise: string;
  let fakeTar: string;
  let fakeMsb: string;
  let miseLog: string;
  let tarLog: string;
  let msbLog: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    workDir = join(tmpdir(), `mise-msb-build-${Date.now()}-${Math.random()}`);
    mkdirSync(workDir, { recursive: true });
    binDir = join(workDir, "bin");
    mkdirSync(binDir, { recursive: true });
    miseLog = join(workDir, "mise.log");
    tarLog = join(workDir, "tar.log");
    msbLog = join(workDir, "msb.log");
    fakeMise = join(binDir, "mise");
    fakeTar = join(binDir, "tar");
    fakeMsb = join(binDir, "msb");
    originalPath = process.env["PATH"];
    process.env["PATH"] = `${binDir}:${originalPath ?? ""}`;
  });

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = originalPath;
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  test("successful Linux pipeline: layout created, archived, and loaded", async () => {
    // In shell, $0 is the script path, so args from Bun.spawn start at $1.
    // mise argv from Bun: [mise, oci, build, --from, ..., --tag, ..., --output, <dir>]
    // In the script: $1=oci, $2=build, $3=--from, $4=..., $5=--tag, $6=..., $7=--output, $8=<dir>
    writeFileSync(
      fakeMise,
      `#!/bin/sh
echo "mise $*" >> "${miseLog}"
mkdir -p "$8"
touch "$8/index.json"
`,
    );
    chmodSync(fakeMise, 0o755);
    // tar argv: [tar, -C, <layoutDir>, -cf, <archivePath>, .]
    // In the script: $1=-C, $2=<layoutDir>, $3=-cf, $4=<archivePath>, $5=.
    writeFileSync(
      fakeTar,
      `#!/bin/sh
echo "tar $*" >> "${tarLog}"
touch "$4"
`,
    );
    chmodSync(fakeTar, 0o755);
    writeFileSync(fakeMsb, `#!/bin/sh\necho "msb $*" >> "${msbLog}"\n`);
    chmodSync(fakeMsb, 0o755);

    const outputDir = join(workDir, "out");
    const result = await buildOciImage({
      config: baseConfig(),
      projectRoot: workDir,
      printOnly: false,
      outputDir,
      platform: "linux",
      miseBinary: fakeMise,
      msbBinary: fakeMsb,
    });
    expect(result.exitCode).toBe(0);
    // Cleanup on success removes the output directory entirely.
    expect(existsSync(outputDir)).toBe(false);
    const miseRecord = readFileSync(miseLog, "utf8");
    expect(miseRecord).toContain("mise oci build");
    expect(miseRecord).toContain("--from ubuntu:24.04");
    expect(miseRecord).toContain("--tag p:dev");
    // mise received the layout path as $8.
    expect(miseRecord).toContain("/layout");
    const msbRecord = readFileSync(msbLog, "utf8");
    expect(msbRecord).toContain("msb image load");
    expect(msbRecord).toContain("--tag p:dev");
  });

  test("mise oci build failure: archive preserved and failed stage reported", async () => {
    writeFileSync(fakeMise, "#!/bin/sh\nexit 1\n");
    chmodSync(fakeMise, 0o755);
    writeFileSync(fakeTar, "#!/bin/sh\nexit 0\n");
    chmodSync(fakeTar, 0o755);
    writeFileSync(fakeMsb, "#!/bin/sh\nexit 0\n");
    chmodSync(fakeMsb, 0o755);

    const outputDir = join(workDir, "out");
    const result = await buildOciImage({
      config: baseConfig(),
      projectRoot: workDir,
      printOnly: false,
      outputDir,
      platform: "linux",
      miseBinary: fakeMise,
      msbBinary: fakeMsb,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.failedStage).toBe("mise oci build");
    // Cleanup is NOT performed on failure — the artifacts stay for diagnostics.
    expect(existsSync(outputDir)).toBe(true);
    expect(result.archivePath).toContain("image.tar");
  });

  test("tar failure: misbehaving tar preserves the layout and reports tar as the failed stage", async () => {
    writeFileSync(fakeMise, `#!/bin/sh\nmkdir -p "$8"\ntouch "$8/index.json"\n`);
    chmodSync(fakeMise, 0o755);
    writeFileSync(fakeTar, "#!/bin/sh\nexit 2\n");
    chmodSync(fakeTar, 0o755);
    writeFileSync(fakeMsb, "#!/bin/sh\nexit 0\n");
    chmodSync(fakeMsb, 0o755);

    const outputDir = join(workDir, "out");
    const result = await buildOciImage({
      config: baseConfig(),
      projectRoot: workDir,
      printOnly: false,
      outputDir,
      platform: "linux",
      miseBinary: fakeMise,
      msbBinary: fakeMsb,
    });
    expect(result.exitCode).toBe(2);
    expect(result.failedStage).toBe("tar");
  });

  test("msb image load failure: archive preserved with actionable path", async () => {
    writeFileSync(fakeMise, `#!/bin/sh\nmkdir -p "$8"\ntouch "$8/index.json"\n`);
    chmodSync(fakeMise, 0o755);
    writeFileSync(fakeTar, `#!/bin/sh\ntouch "$4"\n`);
    chmodSync(fakeTar, 0o755);
    writeFileSync(fakeMsb, "#!/bin/sh\nexit 3\n");
    chmodSync(fakeMsb, 0o755);

    const outputDir = join(workDir, "out");
    const result = await buildOciImage({
      config: baseConfig(),
      projectRoot: workDir,
      printOnly: false,
      outputDir,
      platform: "linux",
      miseBinary: fakeMise,
      msbBinary: fakeMsb,
    });
    expect(result.exitCode).toBe(3);
    expect(result.failedStage).toBe("msb image load");
    expect(existsSync(result.archivePath)).toBe(true);
  });
});
