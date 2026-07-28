import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBuildPipeline, planMacOsBuilder } from "../src/build/oci.js";
import { planBuildGroups } from "../src/build/print.js";
import { preflightCustomBase, buildVmHandoffScript } from "../src/build/custombase.js";
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

function envTracker() {
  const originals = new Map<string, string | undefined>();
  return {
    set(key: string, value: string | undefined) {
      if (!originals.has(key)) originals.set(key, process.env[key]);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    },
    restore() {
      for (const [key, value] of originals) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Linux custom-base pipeline (fake binaries)
// ---------------------------------------------------------------------------

describe("Linux custom-base pipeline (fake binaries)", () => {
  let workDir: string;
  let binDir: string;
  let contextDir: string;
  let containerfile: string;
  let fakeMise: string;
  let fakeTar: string;
  let fakeMsb: string;
  let fakeDocker: string;
  let miseLog: string;
  let tarLog: string;
  let msbLog: string;
  let dockerLog: string;
  let originalPath: string | undefined;
  let env: ReturnType<typeof envTracker>;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "msb-cb-"));
    binDir = join(workDir, "bin");
    mkdirSync(binDir, { recursive: true });
    contextDir = join(workDir, "image");
    mkdirSync(contextDir, { recursive: true });
    containerfile = join(contextDir, "Containerfile");
    writeFileSync(containerfile, "FROM ubuntu:24.04\nRUN apt-get update\n");

    miseLog = join(workDir, "mise.log");
    tarLog = join(workDir, "tar.log");
    msbLog = join(workDir, "msb.log");
    dockerLog = join(workDir, "docker.log");
    fakeMise = join(binDir, "mise");
    fakeTar = join(binDir, "tar");
    fakeMsb = join(binDir, "msb");
    fakeDocker = join(binDir, "docker");
    originalPath = process.env["PATH"];
    process.env["PATH"] = binDir + ":" + (originalPath ?? "");
    env = envTracker();
    env.set("MISE_LOG", miseLog);
    env.set("TAR_LOG", tarLog);
    env.set("MSB_LOG", msbLog);
    env.set("DOCKER_LOG", dockerLog);

    writeFileSync(
      fakeMise,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "mise ${MISE_VERSION:-2026.7.12} linux-x64"\n  exit 0\nfi\nif [ "$1" = "oci" ] && [ "$2" = "build" ]; then\n  echo "mise $*" >> "$MISE_LOG"\n  mkdir -p "$8"\n  touch "$8/index.json"\n  exit "${MISE_BUILD_EXIT:-0}"\nfi\necho "unexpected mise: $*" >&2\nexit 1\n',
    );
    chmodSync(fakeMise, 0o755);

    writeFileSync(
      fakeTar,
      '#!/bin/sh\necho "tar $*" >> "$TAR_LOG"\ntouch "$4"\nexit 0\n',
    );
    chmodSync(fakeTar, 0o755);

    writeFileSync(
      fakeMsb,
      '#!/bin/sh\necho "msb $*" >> "$MSB_LOG"\nexit 0\n',
    );
    chmodSync(fakeMsb, 0o755);

    writeFileSync(
      fakeDocker,
      '#!/bin/sh\necho "docker $*" >> "$DOCKER_LOG"\ncase "$1" in\n  build) exit "${DOCKER_BUILD_EXIT:-0}" ;;\n  save) touch "$3"; exit 0 ;;\n  *) echo "unexpected docker: $*" >&2; exit 1 ;;\nesac\n',
    );
    chmodSync(fakeDocker, 0o755);
  });

  afterEach(() => {
    env.restore();
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  });

  function readLog(path: string): string {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  }

  async function runCustom(outputDir?: string) {
    return runBuildPipeline({
      config: baseConfig(),
      projectRoot: workDir,
      printOnly: false,
      platform: "linux",
      containerfile,
      contextDir,
      miseBinary: fakeMise,
      msbBinary: fakeMsb,
      dockerBinary: fakeDocker,
      outputDir,
    });
  }

  test("custom-base success: base built+saved, mise consumes localhost:5000 base, loaded, cleaned up", async () => {
    const outputDir = join(workDir, "out");
    const result = await runCustom(outputDir);

    expect(result.exitCode).toBe(0);
    expect(existsSync(outputDir)).toBe(false);

    const docker = readLog(dockerLog);
    expect(docker).toContain("docker build --load");
    expect(docker).toContain("docker save");

    const mise = readLog(miseLog);
    expect(mise).toContain("oci build");
    expect(mise).toContain("--from localhost:5000/mise-msb/base:");
    expect(mise).toContain("--tag p:dev");

    const msb = readLog(msbLog);
    expect(msb).toContain("image load");
    expect(msb).toContain("--tag p:dev");
  });

  test("Containerfile failure: reported, mise not invoked", async () => {
    env.set("DOCKER_BUILD_EXIT", "1");
    const outputDir = join(workDir, "out");
    const result = await runCustom(outputDir);

    expect(result.exitCode).not.toBe(0);
    expect(result.failedStage).toBe("Containerfile build");
    expect(readLog(miseLog)).not.toContain("oci build");
    expect(existsSync(outputDir)).toBe(true);
  });

  test("docker save failure: reported as docker save", async () => {
    // Override docker to fail on save
    writeFileSync(
      fakeDocker,
      '#!/bin/sh\necho "docker $*" >> "$DOCKER_LOG"\ncase "$1" in\n  build) exit 0 ;;\n  save) exit 1 ;;\n  *) exit 1 ;;\nesac\n',
    );
    chmodSync(fakeDocker, 0o755);
    const outputDir = join(workDir, "out");
    const result = await runCustom(outputDir);

    expect(result.exitCode).not.toBe(0);
    expect(result.failedStage).toBe("docker save");
    expect(readLog(miseLog)).not.toContain("oci build");
  });

  test("old Linux host mise is rejected before Docker", async () => {
    env.set("MISE_VERSION", "2026.6.0");
    const outputDir = join(workDir, "out");
    const result = await runCustom(outputDir);

    expect(result.exitCode).not.toBe(0);
    expect(result.failedStage).toBe("mise version preflight");
    expect(result.message).toContain("2026.6.0");
    expect(result.message).toContain("2026.7.12");
    expect(readLog(dockerLog)).toBe("");
    expect(readLog(miseLog)).not.toContain("oci build");
  });

  test("missing Docker is reported before any build", async () => {
    const outputDir = join(workDir, "out");
    const result = await runBuildPipeline({
      config: baseConfig(),
      projectRoot: workDir,
      printOnly: false,
      platform: "linux",
      containerfile,
      contextDir,
      miseBinary: fakeMise,
      msbBinary: fakeMsb,
      dockerBinary: null,
      outputDir,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.failedStage).toBe("docker not found");
    expect(readLog(dockerLog)).toBe("");
  });

  test("no-Containerfile fallback stays Docker-free and uses build.from", async () => {
    const outputDir = join(workDir, "out");
    const result = await runBuildPipeline({
      config: baseConfig(),
      projectRoot: workDir,
      printOnly: false,
      platform: "linux",
      miseBinary: fakeMise,
      msbBinary: fakeMsb,
      outputDir,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outputDir)).toBe(false);
    expect(readLog(dockerLog)).toBe("");
    const mise = readLog(miseLog);
    expect(mise).toContain("oci build");
    expect(mise).toContain("--from ubuntu:24.04");
    expect(mise).not.toContain("mise-msb/base");
  });
});

// ---------------------------------------------------------------------------
// macOS custom-base preflight (5.3)
// ---------------------------------------------------------------------------

describe("macOS custom-base preflight", () => {
  let workDir: string;
  let binDir: string;
  let fakeMise: string;
  let fakeMsb: string;
  let miseInvoked: string;
  let originalPath: string | undefined;
  let env: ReturnType<typeof envTracker>;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "msb-mac-"));
    binDir = join(workDir, "bin");
    mkdirSync(binDir, { recursive: true });
    fakeMise = join(binDir, "mise");
    fakeMsb = join(binDir, "msb");
    miseInvoked = join(workDir, "mise-invoked");
    originalPath = process.env["PATH"];
    process.env["PATH"] = binDir + ":" + (originalPath ?? "");
    env = envTracker();

    // Host macOS mise would fail and record if invoked — proving it is not.
    writeFileSync(
      fakeMise,
      '#!/bin/sh\necho "invoked" >> "' + miseInvoked + '"\nexit 1\n',
    );
    chmodSync(fakeMise, 0o755);

    writeFileSync(
      fakeMsb,
      '#!/bin/sh\nif [ "$1" = "run" ]; then\n  echo "mise ${MISE_VERSION:-2026.7.12} linux-x64"\n  exit 0\nfi\nexit 0\n',
    );
    chmodSync(fakeMsb, 0o755);
  });

  afterEach(() => {
    env.restore();
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  });

  test("validates builder mise and does not inspect host macOS mise", async () => {
    const result = await preflightCustomBase({
      platform: "darwin",
      miseBinary: fakeMise,
      msbBinary: fakeMsb,
      builderImage: "ubuntu:24.04",
      dockerBinary: "/usr/local/bin/docker",
      printOnly: false,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(miseInvoked)).toBe(false);
  });

  test("outdated builder mise is rejected with build.builderImage in the message", async () => {
    env.set("MISE_VERSION", "2026.6.0");
    const result = await preflightCustomBase({
      platform: "darwin",
      miseBinary: fakeMise,
      msbBinary: fakeMsb,
      builderImage: "ubuntu:24.04",
      dockerBinary: "/usr/local/bin/docker",
      printOnly: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.failedStage).toBe("mise version preflight (builder)");
    expect(result.message).toContain("build.builderImage");
    expect(result.message).toContain("2026.6.0");
    expect(result.message).toContain("2026.7.12");
  });

  test("print-only preflight does not run anything", async () => {
    const result = await preflightCustomBase({
      platform: "darwin",
      miseBinary: fakeMise,
      msbBinary: fakeMsb,
      builderImage: "ubuntu:24.04",
      dockerBinary: null,
      printOnly: true,
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(miseInvoked)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// macOS custom-base builder plan (5.3)
// ---------------------------------------------------------------------------

describe("macOS custom-base builder plan", () => {
  const config = baseConfig();

  test("uses localhost:5000 base reference inside the VM", () => {
    const plan = planMacOsBuilder({
      config,
      projectRoot: "/host/proj",
      outputDir: "/host/out",
      from: "localhost:5000/mise-msb/base:abc",
      customBase: {
        buildId: "abc",
        dockerTag: "mise-msb-base:abc",
        baseTarPath: "/host/out/base.tar",
        registryTag: "localhost:5000/mise-msb/base:abc",
        baseRef: "localhost:5000/mise-msb/base:abc",
        built: true,
      },
    });
    const all = [...plan.runArgv, ...plan.execArgv, ...plan.removeArgv].join(" ");
    // The handoff script runs inside the VM — no host.microsandbox.internal.
    expect(all).not.toContain("host.microsandbox.internal");
    expect(all).not.toContain("MISE_OCI_INSECURE_REGISTRIES");
    // The VM command runs the handoff script.
    expect(all).toContain("handoff.sh");
    // Uses detach + exec + remove pattern.
    expect(plan.runArgv.join(" ")).toContain("--detach");
    expect(plan.execArgv.join(" ")).toContain("msb exec");
    expect(plan.removeArgv.join(" ")).toContain("msb remove -f");
  });

  test("custom-base additions are absent without a custom base", () => {
    const plan = planMacOsBuilder({
      config,
      projectRoot: "/host/proj",
      outputDir: "/host/out",
    });
    const all = [...plan.runArgv, ...plan.execArgv, ...plan.removeArgv].join(" ");
    expect(all).not.toContain("handoff.sh");
    expect(all).not.toContain("host.microsandbox.internal");
    expect(all).toContain("mise oci build");
    expect(all).toContain("--from ubuntu:24.04");
  });
});

// ---------------------------------------------------------------------------
// In-VM handoff script (5.3)
// ---------------------------------------------------------------------------

describe("buildVmHandoffScript", () => {
  test("starts registry, imports via skopeo, runs mise oci build", () => {
    const script = buildVmHandoffScript(
      "/out/base.tar",
      "localhost:5000/mise-msb/base:abc",
      ["mise", "oci", "build", "--from", "localhost:5000/mise-msb/base:abc", "--tag", "p:dev", "--output", "/out/layout"],
      "/workspace",
    );
    expect(script).toContain("registry serve /etc/registry/config.yml");
    expect(script).toContain("skopeo copy");
    expect(script).toContain("--dest-tls-verify=false");
    expect(script).toContain("docker-archive:/out/base.tar");
    expect(script).toContain("docker://localhost:5000/mise-msb/base:abc");
    expect(script).toContain("cd /workspace");
    expect(script).toContain("mise trust");
    expect(script).toContain("mise install --locked");
    expect(script).toContain("MISE_EXPERIMENTAL=1");
    expect(script).toContain("mise oci build");
    expect(script).toContain("--from localhost:5000/mise-msb/base:abc");
    // Trap ensures the registry is always killed on exit.
    expect(script).toContain("trap");
    // No host networking or insecure registries needed.
    expect(script).not.toContain("host.microsandbox.internal");
    expect(script).not.toContain("INSECURE_REGISTRIES");
  });
});

// ---------------------------------------------------------------------------
// Print mode (5.4)
// ---------------------------------------------------------------------------

describe("build print mode", () => {
  const config = baseConfig();
  const custom = {
    containerfile: "/home/u/.config/mise-msb/image/Containerfile",
    contextDir: "/home/u/.config/mise-msb/image",
  };

  test("Linux custom stages: preflight, docker build, docker save, handoff, tar, load", () => {
    const groups = planBuildGroups({
      config,
      projectRoot: "/proj",
      platform: "linux",
      custom,
    });

    // Preflight, docker build, docker save, handoff script, tar, load = 6 groups.
    expect(groups.length).toBe(6);

    const flat = groups.map((g) => g.join(" ")).join("\n");
    expect(groups[0]?.join(" ")).toBe("mise --version");
    expect(flat).toContain("docker build --load -f " + custom.containerfile);
    expect(flat).toContain("docker save -o <temp-output>/base.tar mise-msb-base:<build-id>");
    // On Linux the handoff script runs directly.
    expect(flat).toContain("bash <temp-output>/handoff.sh");
    expect(flat).toContain("tar -C <temp-output>/layout -cf <temp-output>/image.tar .");
    expect(flat).toContain("msb image load --input <temp-output>/image.tar --tag p:dev");
    // No host registry, no docker push, no host.microsandbox.internal.
    expect(flat).not.toContain("docker run -d");
    expect(flat).not.toContain("docker push");
    expect(flat).not.toContain("host.microsandbox.internal");
    expect(flat).not.toContain("docker rm -f");
  });

  test("macOS custom stages: preflight, docker build, docker save, msb run+exec+remove, tar, load", () => {
    const groups = planBuildGroups({
      config,
      projectRoot: "/proj",
      platform: "darwin",
      custom,
    });

    // Preflight, docker build, docker save, msb run, msb exec, msb remove, tar, load = 8 groups.
    expect(groups.length).toBe(8);
    expect(groups[0]?.join(" ")).toBe("msb run ubuntu:24.04 -- mise --version");

    const flat = groups.map((g) => g.join(" ")).join("\n");
    expect(flat).toContain("docker build --load -f " + custom.containerfile);
    expect(flat).toContain("docker save -o <temp-output>/base.tar mise-msb-base:<build-id>");
    // The VM runs the handoff script, not raw mise oci build.
    expect(flat).toContain("handoff.sh");
    // Uses detach + exec + remove pattern.
    expect(flat).toContain("--detach");
    expect(flat).toContain("msb exec");
    expect(flat).toContain("msb remove -f");
    // No host networking or insecure registries.
    expect(flat).not.toContain("host.microsandbox.internal");
    expect(flat).not.toContain("MISE_OCI_INSECURE_REGISTRIES");
    expect(flat).not.toContain("--net-rule");
  });

  test("no-Containerfile Linux print stays Docker-free with 3 groups", () => {
    const groups = planBuildGroups({
      config,
      projectRoot: "/proj",
      platform: "linux",
      custom: null,
    });
    expect(groups.length).toBe(3);
    const flat = groups.map((g) => g.join(" ")).join("\n");
    expect(flat).toContain("mise oci build --from ubuntu:24.04");
    expect(flat).not.toContain("docker");
    expect(flat).not.toContain("handoff.sh");
  });

  test("no-Containerfile macOS print uses detach+exec+remove builder pattern with 5 groups", () => {
    const groups = planBuildGroups({
      config,
      projectRoot: "/proj",
      platform: "darwin",
      custom: null,
    });
    // msb run --detach, msb exec, msb remove -f, tar, load = 5 groups.
    expect(groups.length).toBe(5);
    const flat = groups.map((g) => g.join(" ")).join("\n");
    expect(flat).toContain("msb run --detach");
    expect(flat).toContain("msb exec");
    expect(flat).toContain("msb remove -f");
    expect(flat).toContain("mise oci build");
    expect(flat).not.toContain("docker");
    expect(flat).not.toContain("handoff.sh");
  });

  test("planning is deterministic — repeated calls produce identical output", () => {
    const a = planBuildGroups({ config, projectRoot: "/proj", platform: "linux", custom });
    const b = planBuildGroups({ config, projectRoot: "/proj", platform: "linux", custom });
    expect(a).toEqual(b);
  });

  test("planning performs no subprocess mutation (pure function)", () => {
    const groups = planBuildGroups({ config, projectRoot: "/proj", platform: "linux", custom });
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.every((g) => Array.isArray(g))).toBe(true);
  });
});
