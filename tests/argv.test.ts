import { describe, expect, test } from "bun:test";
import { buildCreateArgv, mountArgv, portToString, secretArgv } from "../src/msb/argv.js";
import { formatArgv, quoteArg } from "../src/msb/print.js";
import { BUILTIN_DEFAULTS, type SandboxConfig } from "../src/config/types.js";

function baseConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    ...BUILTIN_DEFAULTS,
    identity: { name: "p", workdir: "/workspace" },
    stock: { ...BUILTIN_DEFAULTS.stock },
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

describe("buildCreateArgv", () => {
  test("emits image positional and canonical flags", () => {
    const argv = buildCreateArgv({ image: "p:dev", name: "p", config: baseConfig() });
    expect(argv[0]).toBe("msb");
    expect(argv[1]).toBe("create");
    expect(argv[2]).toBe("p:dev");
    expect(argv).toContain("--name");
    expect(argv).toContain("p");
    expect(argv).toContain("--cpus");
    expect(argv).toContain("4");
    expect(argv).toContain("--memory");
    expect(argv).toContain("8G");
  });

  test("emits sorted env and labels", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        env: { B: "2", A: "1" },
        labels: { team: "platform", app: "demo" },
      }),
    });
    const envIndex = argv.indexOf("--env");
    expect(argv[envIndex + 1]).toBe("A=1");
    expect(argv[envIndex + 3]).toBe("B=2");
    const labelIndex = argv.indexOf("--label");
    expect(argv[labelIndex + 1]).toBe("app=demo");
  });

  test("emits sorted network allow rules", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        network: {
          defaultEgress: "deny",
          allow: ["b.example:tcp:443", "a.example:tcp:443"],
          inherit: true,
        },
      }),
    });
    expect(argv).toContain("--net-default");
    expect(argv[argv.indexOf("--net-default") + 1]).toBe("deny");
    expect(argv).toContain("allow@a.example:tcp:443");
    expect(argv).toContain("allow@b.example:tcp:443");
  });

  test("emits sorted secrets as source@host pairs", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        secrets: {
          B: { from: "ENV_B", hosts: ["b.example"] },
          A: { from: "ENV_A", hosts: ["a.example"] },
        },
      }),
    });
    expect(argv).toContain("--secret");
    expect(argv).toContain("ENV_A@a.example");
    expect(argv).toContain("ENV_B@b.example");
  });

  test("emits sorted mounts by name", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        mounts: {
          z: { kind: "named", source: "z", target: "/z" },
          a: { kind: "dir", source: ".", target: "/a" },
        },
      }),
    });
    const aIndex = argv.indexOf(".:/a");
    const zIndex = argv.indexOf("z:/z");
    expect(aIndex).toBeGreaterThan(-1);
    expect(zIndex).toBeGreaterThan(-1);
    expect(aIndex).toBeLessThan(zIndex);
    expect(argv).toContain("--mount-named");
    expect(argv).toContain("--mount-dir");
  });

  test("emits sorted ports with explicit loopback bind", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        ports: {
          web: { hostPort: 8080, guestPort: 8080, protocol: "tcp", bind: "127.0.0.1" },
          dns: { hostPort: 5353, guestPort: 53, protocol: "udp", bind: "0.0.0.0" },
        },
      }),
    });
    expect(argv).toContain("127.0.0.1:8080:8080");
    expect(argv).toContain("0.0.0.0:5353:53/udp");
  });

  test("snapshot: complete config yields deterministic argv", () => {
    const cfg = baseConfig({
      env: { NODE_ENV: "production" },
      mounts: { cache: { kind: "named", source: "cache", target: "/cache" } },
      ports: { web: { hostPort: 8080, guestPort: 8080, protocol: "tcp", bind: "127.0.0.1" } },
      secrets: { K: { from: "K", hosts: ["api.example"] } },
      network: { defaultEgress: "deny", allow: ["github.com:tcp:443"], inherit: true },
    });
    const argv = buildCreateArgv({ image: "p:dev", name: "p", config: cfg });
    const expected =
      "msb create p:dev --name p --cpus 4 --memory 8G --workdir /workspace " +
      "--env NODE_ENV=production --net-default deny --net-rule allow@github.com:tcp:443 " +
      "--secret K@api.example --mount-named cache:/cache --mount-named p-mise-v1:/mise " +
      "--mount-named p-docker-data:/var/lib/docker:kind=disk,size=10G " +
      "--port 127.0.0.1:8080:8080";
    expect(formatArgv(argv)).toBe(expected);
  });

  test("shell metacharacters in env values are not evaluated", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        env: { GREETING: "hello $(rm -rf /); world" },
      }),
    });
    expect(argv).toContain("GREETING=hello $(rm -rf /); world");
    // And it survives shell quoting too.
    expect(formatArgv(argv)).toContain("'GREETING=hello $(rm -rf /); world'");
  });
});

describe("mountArgv", () => {
  test("dir mount", () => {
    expect(mountArgv({ kind: "dir", source: ".", target: "/w" })).toEqual([
      "--mount-dir",
      ".:/w",
    ]);
  });
  test("named mount", () => {
    expect(mountArgv({ kind: "named", source: "vol", target: "/v" })).toEqual([
      "--mount-named",
      "vol:/v",
    ]);
  });
  test("disk mount with size", () => {
    expect(
      mountArgv({ kind: "disk", source: "d", target: "/d", size: "5G" }),
    ).toEqual(["--mount-named", "d:/d:kind=disk,size=5G"]);
  });
  test("file mount with options", () => {
    expect(
      mountArgv({ kind: "file", source: "f", target: "/f", options: "ro" }),
    ).toEqual(["--mount-file", "f:/f:ro"]);
  });
});

describe("portToString", () => {
  test("tcp with default bind", () => {
    expect(
      portToString({ hostPort: 8080, guestPort: 8080, protocol: "tcp", bind: "127.0.0.1" }),
    ).toBe("127.0.0.1:8080:8080");
  });
  test("udp with explicit bind", () => {
    expect(
      portToString({ hostPort: 5353, guestPort: 53, protocol: "udp", bind: "0.0.0.0" }),
    ).toBe("0.0.0.0:5353:53/udp");
  });
});

describe("secretArgv", () => {
  test("emits one --secret per host, sorted", () => {
    const argv = secretArgv({ from: "ENV", hosts: ["b", "a"] });
    expect(argv).toEqual(["--secret", "ENV@a", "--secret", "ENV@b"]);
  });
});

describe("quoteArg", () => {
  test("plainword passes through", () => {
    expect(quoteArg("simple")).toBe("simple");
  });
  test("empty string is quoted", () => {
    expect(quoteArg("")).toBe("''");
  });
  test("spaces force quoting", () => {
    expect(quoteArg("with spaces")).toBe("'with spaces'");
  });
  test("single quotes are escaped", () => {
    expect(quoteArg("with'apos")).toBe("'with'\\''apos'");
  });
});
