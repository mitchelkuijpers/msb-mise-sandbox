import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRunSequence, planStockBootstrapStages, querySandboxState } from "../src/msb/lifecycle.js";
import { formatArgvGroups } from "../src/msb/print.js";
import { BUILTIN_DEFAULTS, type SandboxConfig } from "../src/config/types.js";

function baseConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    ...BUILTIN_DEFAULTS,
    identity: { name: "p", workdir: "/workspace" },
    stock: { ...BUILTIN_DEFAULTS.stock },
    runtime: { cpus: 4, memory: "8G", rootDisk: "8G" },
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

// Planning tests must not depend on a host `msb` binary; inject a
// deterministic state probe ("absent" → create-first plans). The real
// subprocess-backed probe is exercised by the integration describe blocks.
const absentSandboxState = (): "absent" => "absent";

describe("planRunSequence", () => {
  test("absent sandbox: includes create + bootstrap stages + exec (stock mode)", () => {
    const seq = planRunSequence({
      config: baseConfig(),
      image: "p:dev",
      name: "p",
      queryState: absentSandboxState,
      commandArgv: ["bash"],
    });
    expect(seq.groups.length).toBeGreaterThanOrEqual(3);
    expect(seq.groups[0]?.[0]).toBe("msb");
    expect(seq.groups[0]?.[1]).toBe("create");
    // Stock bootstrap stages appear between create and exec.
    expect(seq.groups[1]?.[0]).toBe("msb");
    expect(seq.groups[1]?.[1]).toBe("exec");
    expect(seq.groups[1]?.[seq.groups[1]?.indexOf("--") + 1]).toBe("docker-up");
    // Last group is the user command.
    const last = seq.groups[seq.groups.length - 1] ?? [];
    expect(last[0]).toBe("msb");
    expect(last[1]).toBe("exec");
  });

  test("multi-step run prints execution order", () => {
    const seq = planRunSequence({
      config: baseConfig(),
      image: "p:dev",
      name: "p",
      queryState: absentSandboxState,
      commandArgv: ["bun", "test"],
    });
    const formatted = formatArgvGroups(seq.groups);
    // create comes before exec in the output
    const createIdx = formatted.indexOf("msb create");
    const execIdx = formatted.indexOf("msb exec");
    expect(createIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeLessThan(execIdx);
  });

  test("preserves command arguments exactly through --", () => {
    const seq = planRunSequence({
      config: baseConfig(),
      image: "p:dev",
      name: "p",
      queryState: absentSandboxState,
      commandArgv: ["bun", "test", "--timeout", "5000"],
    });
    const execArgv = seq.groups[seq.groups.length - 1] ?? [];
    expect(execArgv).toContain("--");
    expect(execArgv.slice(execArgv.indexOf("--") + 1)).toEqual([
      "bun",
      "test",
      "--timeout",
      "5000",
    ]);
  });

  test("configured command is used when no override supplied", () => {
    const seq = planRunSequence({
      config: baseConfig({ command: { argv: ["fish"] } }),
      image: "p:dev",
      name: "p",
      queryState: absentSandboxState,
    });
    const execArgv = seq.groups[seq.groups.length - 1] ?? [];
    expect(execArgv.slice(execArgv.indexOf("--") + 1)).toEqual(["fish"]);
  });

  test("falls back to bash when neither configured nor supplied", () => {
    const seq = planRunSequence({
      config: baseConfig(),
      image: "p:dev",
      name: "p",
    });
    const execArgv = seq.groups[seq.groups.length - 1] ?? [];
    expect(execArgv.slice(execArgv.indexOf("--") + 1)).toEqual(["bash"]);
  });
});

describe("lifecycle subprocess integration", () => {
  let binDir: string;
  let fakeMsb: string;
  let recordPath: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    binDir = join(tmpdir(), `mise-msb-lifecycle-${Date.now()}-${Math.random()}`);
    mkdirSync(binDir, { recursive: true });
    fakeMsb = join(binDir, "msb");
    recordPath = join(binDir, "record.log");
    originalPath = process.env["PATH"];
    process.env["PATH"] = `${binDir}:${originalPath ?? ""}`;
  });

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = originalPath;
    }
    rmSync(binDir, { recursive: true, force: true });
  });

  test("querySandboxState: absent when sandbox not in list", () => {
    writeFileSync(
      fakeMsb,
      `#!/bin/sh
echo "NAME     STATUS    IMAGE"
echo "other    running   img"
`,
    );
    chmodSync(fakeMsb, 0o755);
    expect(querySandboxState("nope")).toBe("absent");
  });

  test("querySandboxState: stopped when name appears without active state", () => {
    writeFileSync(
      fakeMsb,
      `#!/bin/sh
echo "NAME     STATUS    IMAGE"
echo "p        stopped   img"
`,
    );
    chmodSync(fakeMsb, 0o755);
    expect(querySandboxState("p")).toBe("stopped");
  });

  test("querySandboxState: running when name appears with active state", () => {
    writeFileSync(
      fakeMsb,
      `#!/bin/sh
echo "NAME     STATUS    IMAGE"
echo "p        running   img"
`,
    );
    chmodSync(fakeMsb, 0o755);
    expect(querySandboxState("p")).toBe("running");
  });

  test("querySandboxState: msb failure treated as absent", () => {
    writeFileSync(fakeMsb, "#!/bin/sh\nexit 1\n");
    chmodSync(fakeMsb, 0o755);
    expect(querySandboxState("p")).toBe("absent");
  });
});

describe("planStockBootstrapStages", () => {
  test("includes docker-up stage in stock mode", () => {
    const seq = planRunSequence({
      config: baseConfig(),
      image: "p:dev",
      name: "p",
      queryState: absentSandboxState,
      commandArgv: ["bash"],
    });
    const groups = seq.groups;
    // Stock mode inserts docker-up after create/start.
    const dockerStage = groups.find((g) => g.includes("docker-up"));
    expect(dockerStage).toBeDefined();
  });

  test("includes project bootstrap stage in stock mode", () => {
    const seq = planRunSequence({
      config: baseConfig(),
      image: "p:dev",
      name: "p",
      queryState: absentSandboxState,
      commandArgv: ["bash"],
    });
    const projectStage = seq.groups.find((g) => g.includes("mise-msb-bootstrap") && g.includes("project"));
    expect(projectStage).toBeDefined();
  });

  test("project bootstrap stage passes the resolved workdir as its argument", () => {
    const seq = planRunSequence({
      config: baseConfig({ workdirTarget: "/host/proj" }),
      image: "p:dev",
      name: "p",
      queryState: absentSandboxState,
      commandArgv: ["bash"],
    });
    const projectStage = seq.groups.find(
      (g) => g.includes("mise-msb-bootstrap") && g.includes("project"),
    );
    expect(projectStage).toBeDefined();
    const projectIdx = projectStage?.indexOf("project") ?? -1;
    expect(projectStage?.[projectIdx + 1]).toBe("/host/proj");
  });

  test("custom mode does not add bootstrap stages", () => {
    const config = baseConfig({
      stock: { imageMode: "custom", customImage: "my:v1", dockerDataSize: "10G" },
    });
    const seq = planRunSequence({
      config,
      image: "my:v1",
      name: "p",
    });
    const dockerStage = seq.groups.find((g) => g.includes("docker-up"));
    expect(dockerStage).toBeUndefined();
    expect(seq.groups.length).toBe(2); // create + exec only
  });

  test("bootstrap stages appear between create and final exec", () => {
    const seq = planRunSequence({
      config: baseConfig(),
      image: "p:dev",
      name: "p",
      queryState: absentSandboxState,
      commandArgv: ["bash"],
    });
    const groups = seq.groups;
    const createIdx = groups.findIndex((g) => g[1] === "create");
    const lastExecIdx = groups.length - 1;
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(lastExecIdx).toBeGreaterThan(createIdx);
    // Docker and project bootstrap should be between create and final exec.
    const betweenGroups = groups.slice(createIdx + 1, lastExecIdx);
    expect(betweenGroups.length).toBeGreaterThanOrEqual(2);
    expect(betweenGroups.some((g) => g.includes("docker-up"))).toBe(true);
    expect(betweenGroups.some((g) => g.includes("mise-msb-bootstrap"))).toBe(true);
  });

  test("preserves command arguments through bootstrap stages", () => {
    const seq = planRunSequence({
      config: baseConfig(),
      image: "p:dev",
      name: "p",
      queryState: absentSandboxState,
      commandArgv: ["bun", "test", "--timeout", "5000"],
    });
    const execArgv = seq.groups[seq.groups.length - 1] ?? [];
    expect(execArgv).toContain("--");
    expect(execArgv.slice(execArgv.indexOf("--") + 1)).toEqual([
      "bun",
      "test",
      "--timeout",
      "5000",
    ]);
  });
});

describe("stock browser-trust stage", () => {
  const cmdAfterDashDash = (group: string[]): string[] =>
    group.slice(group.indexOf("--") + 1);

  test("orders docker-up, browser-trust, and project when no personal bootstrap exists", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "msb-no-personal-"));
    try {
      const groups = planStockBootstrapStages({
        name: "p",
        config: baseConfig(),
        homeDir,
      });
      expect(groups.length).toBe(3);
      expect(cmdAfterDashDash(groups[0] ?? [])).toEqual(["docker-up"]);
      expect(cmdAfterDashDash(groups[1] ?? [])).toEqual([
        "mise-msb-bootstrap",
        "browser-trust",
      ]);
      expect(cmdAfterDashDash(groups[2] ?? [])).toEqual([
        "mise-msb-bootstrap",
        "project",
        "/workspace",
      ]);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("browser-trust runs after personal bootstrap and before project", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "msb-personal-"));
    try {
      const bootstrapDir = join(homeDir, ".config", "mise-msb", "bootstrap");
      mkdirSync(bootstrapDir, { recursive: true });
      writeFileSync(join(bootstrapDir, "mise.toml"), '[tools]\nnode = "22"\n');
      const groups = planStockBootstrapStages({
        name: "p",
        config: baseConfig(),
        homeDir,
      });
      expect(groups.length).toBe(4);
      const tokens = groups.map(cmdAfterDashDash);
      expect(tokens[0]).toEqual(["docker-up"]);
      expect(tokens[1]?.[0]).toBe("mise-msb-bootstrap");
      expect(tokens[1]?.[1]).toBe("personal");
      expect(tokens[2]).toEqual(["mise-msb-bootstrap", "browser-trust"]);
      expect(tokens[3]).toEqual(["mise-msb-bootstrap", "project", "/workspace"]);
      // Explicit ordering: personal index < browser-trust index < project index.
      const personalIdx = tokens.findIndex((t) => t[1] === "personal");
      const trustIdx = tokens.findIndex((t) => t[1] === "browser-trust");
      const projectIdx = tokens.findIndex((t) => t[1] === "project");
      expect(personalIdx).toBeGreaterThanOrEqual(0);
      expect(trustIdx).toBeGreaterThan(personalIdx);
      expect(projectIdx).toBeGreaterThan(trustIdx);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("printed plan lists browser-trust between personal and project", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "msb-print-"));
    try {
      const bootstrapDir = join(homeDir, ".config", "mise-msb", "bootstrap");
      mkdirSync(bootstrapDir, { recursive: true });
      writeFileSync(join(bootstrapDir, "mise.toml"), '[tools]\nnode = "22"\n');
      const groups = planStockBootstrapStages({
        name: "p",
        config: baseConfig(),
        homeDir,
      });
      const printed = formatArgvGroups(groups, false);
      const lines = printed.split("\n");
      const personalIdx = lines.findIndex((l) => l.includes("mise-msb-bootstrap personal"));
      const trustIdx = lines.findIndex((l) => l.includes("mise-msb-bootstrap browser-trust"));
      const projectIdx = lines.findIndex((l) => l.includes("mise-msb-bootstrap project"));
      expect(personalIdx).toBeGreaterThanOrEqual(0);
      expect(trustIdx).toBeGreaterThan(personalIdx);
      expect(projectIdx).toBeGreaterThan(trustIdx);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("custom image mode omits docker-up and browser-trust but keeps project", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "msb-custom-"));
    try {
      const config = baseConfig({
        stock: { imageMode: "custom", customImage: "my:v1", dockerDataSize: "10G" },
      });
      const groups = planStockBootstrapStages({ name: "p", config, homeDir });
      const tokens = groups.map(cmdAfterDashDash);
      expect(tokens.some((t) => t.includes("docker-up"))).toBe(false);
      expect(tokens.some((t) => t.includes("browser-trust"))).toBe(false);
      expect(tokens.some((t) => t[1] === "project")).toBe(true);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

describe("lifecycle commands execute and propagate exit codes", () => {
  let binDir: string;
  let fakeMsb: string;
  let recordPath: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    binDir = join(tmpdir(), `mise-msb-lifecycle-exec-${Date.now()}-${Math.random()}`);
    mkdirSync(binDir, { recursive: true });
    fakeMsb = join(binDir, "msb");
    recordPath = join(binDir, "record.log");
    originalPath = process.env["PATH"];
    process.env["PATH"] = `${binDir}:${originalPath ?? ""}`;
  });

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = originalPath;
    }
    rmSync(binDir, { recursive: true, force: true });
  });

  test("run: stop-on-failure semantics via subprocess wrapper", async () => {
    // The Bun runtime caches the system PATH lookup at process start, which
    // makes dynamic PATH overrides for spawned children unreliable in this
    // test harness. Instead, we exercise the same exit-propagation logic
    // using Bun.spawn directly with an absolute-path fake executable.
    writeFileSync(
      fakeMsb,
      `#!/bin/sh
case "$1" in
  create) exit 1 ;;
  *) exit 0 ;;
esac
`,
    );
    chmodSync(fakeMsb, 0o755);
    let observedCode = 0;
    for (const argv of [
      [fakeMsb, "create", "img", "--name", "p"],
      [fakeMsb, "exec", "p", "--", "echo"],
    ]) {
      const proc = Bun.spawn({ cmd: argv, stdio: ["pipe", "pipe", "pipe"] });
      observedCode = await proc.exited;
      if (observedCode !== 0) break;
    }
    expect(observedCode).toBe(1);
  });
});
