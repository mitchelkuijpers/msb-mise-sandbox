import { describe, expect, test } from "bun:test";
import { buildCreateArgv, mountArgv, portToString, secretArgv } from "../src/msb/argv.js";
import { formatArgv, quoteArg } from "../src/msb/print.js";
import { BUILTIN_DEFAULTS, type SandboxConfig } from "../src/config/types.js";
import { generateGuestGitconfig, guestGitconfigTempPath } from "../src/signing/gitconfig.js";
import { readFileSync } from "node:fs";

const SIGNING_KEY = "/home/op/.config/mise-msb/signing/id_ed25519_sandbox";

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

  test("differing guest and source names generate a literal $MSB_ bridge", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        secrets: {
          OPENCODE_API_KEY: {
            from: "OPENCODE_API_KEY_PERSONAL",
            hosts: ["opencode.ai"],
          },
        },
      }),
    });
    const envIndex = argv.indexOf("--env");
    expect(envIndex).toBeGreaterThan(-1);
    expect(argv[envIndex + 1]).toBe("OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL");
    expect(argv).toContain("--secret");
    expect(argv).toContain("OPENCODE_API_KEY_PERSONAL@opencode.ai");
    // No resolved value is ever placed in argv.
    expect(argv.join(" ")).not.toContain("supersecret");
  });

  test("same-name secrets emit only --secret, no bridge", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        secrets: {
          OPENAI_API_KEY: { from: "OPENAI_API_KEY", hosts: ["api.openai.com"] },
        },
      }),
    });
    expect(argv).not.toContain("OPENAI_API_KEY=$MSB_");
    expect(argv).toContain("--secret");
    expect(argv).toContain("OPENAI_API_KEY@api.openai.com");
  });

  test("differing-name secret with multiple allowed hosts expands each", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        secrets: {
          OPENCODE_API_KEY: {
            from: "OPENCODE_API_KEY_PERSONAL",
            hosts: ["opencode.ai", "api.opencode.ai"],
          },
        },
      }),
    });
    expect(argv).toContain("OPENCODE_API_KEY_PERSONAL@opencode.ai");
    expect(argv).toContain("OPENCODE_API_KEY_PERSONAL@api.opencode.ai");
    // Bridge appears exactly once.
    const bridgeCount = argv.filter((a) => a === "OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL").length;
    expect(bridgeCount).toBe(1);
  });

  test("secret bridge is authoritative over a conflicting ordinary env entry", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        env: { OPENCODE_API_KEY: "literal-env-value" },
        secrets: {
          OPENCODE_API_KEY: {
            from: "OPENCODE_API_KEY_PERSONAL",
            hosts: ["opencode.ai"],
          },
        },
      }),
    });
    expect(argv).toContain("OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL");
    expect(argv.join(" ")).not.toContain("literal-env-value");
  });

  test("argv never contains the resolved host secret value", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        secrets: {
          OPENCODE_API_KEY: {
            from: "OPENCODE_API_KEY_PERSONAL",
            hosts: ["opencode.ai"],
          },
        },
      }),
    });
    // Simulate a leaked real value being looked up by the caller — it
    // must never appear in argv.
    const envValue = "sk-real-personal-token-1234";
    expect(argv.join(" ")).not.toContain(envValue);
  });

  test("mixed same-name and differing-name secrets preserve both behaviors", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        secrets: {
          GITLAB_TOKEN: { from: "GITLAB_TOKEN", hosts: ["gitlab.com"] },
          OPENCODE_API_KEY: {
            from: "OPENCODE_API_KEY_PERSONAL",
            hosts: ["opencode.ai"],
          },
        },
      }),
    });
    // Bridge for the differing one only.
    expect(argv).toContain("OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL");
    expect(argv).not.toContain("GITLAB_TOKEN=$MSB_");
    // Both source-based --secret args emitted.
    expect(argv).toContain("GITLAB_TOKEN@gitlab.com");
    expect(argv).toContain("OPENCODE_API_KEY_PERSONAL@opencode.ai");
  });

  test("bridge and env entries are sorted together deterministically", () => {
    const argv1 = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        env: { Z: "z", A: "a" },
        secrets: {
          M: { from: "M_SRC", hosts: ["m.example"] },
        },
      }),
    });
    const argv2 = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        env: { Z: "z", A: "a" },
        secrets: {
          M: { from: "M_SRC", hosts: ["m.example"] },
        },
      }),
    });
    expect(formatArgv(argv1)).toBe(formatArgv(argv2));
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

  test("signing disabled emits no signing arguments", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({ signing: { enabled: false, key: SIGNING_KEY } }),
    });
    const joined = argv.join(" ");
    expect(joined).not.toContain("/etc/mise-msb/signing");
    expect(joined).not.toContain("GIT_CONFIG_GLOBAL");
    expect(joined).not.toContain("--copy");
  });

  test("signing enabled emits mounts, gitconfig copy, and GIT_CONFIG_GLOBAL deterministically", () => {
    const cfg = baseConfig({ signing: { enabled: true, key: SIGNING_KEY } });
    const argv1 = buildCreateArgv({ image: "p:dev", name: "p", config: cfg });
    const argv2 = buildCreateArgv({ image: "p:dev", name: "p", config: cfg });
    expect(argv1).toEqual(argv2);

    const tmp = guestGitconfigTempPath("p");
    const expected =
      "msb create p:dev --name p --cpus 4 --memory 8G --workdir /workspace " +
      "--net-default allow --mount-named p-mise-v1:/mise " +
      "--mount-named p-docker-data:/var/lib/docker:kind=disk,size=10G " +
      `--mount-file ${SIGNING_KEY}:/etc/mise-msb/signing/id_ed25519_sandbox:ro ` +
      `--mount-file ${SIGNING_KEY}.pub:/etc/mise-msb/signing/id_ed25519_sandbox.pub:ro ` +
      `--copy ${tmp}:/etc/mise-msb/gitconfig ` +
      "--env GIT_CONFIG_GLOBAL=/etc/mise-msb/gitconfig";
    expect(formatArgv(argv1)).toBe(expected);

    // Generated gitconfig pins signing and contains no key material.
    const content = readFileSync(tmp, "utf8");
    expect(content).toContain("format = ssh");
    expect(content).toContain("signingkey = /etc/mise-msb/signing/id_ed25519_sandbox.pub");
    expect(content).toContain("gpgsign = true");
    expect(content).not.toContain("[include]");
    expect(argv1.join(" ")).not.toContain("PRIVATE KEY");
    expect(argv1.join(" ")).not.toContain("ssh-ed25519 AAAA");
  });

  test("signing retargets a mounted host ~/.gitconfig to the neutral include path", () => {
    const home = "/home/op";
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      homeDir: home,
      config: baseConfig({
        signing: { enabled: true, key: SIGNING_KEY },
        mounts: {
          "git-config": { kind: "file", source: "~/.gitconfig", target: "/root/.gitconfig", options: "ro" },
        },
      }),
    });
    expect(argv).toContain(`~/.gitconfig:/etc/mise-msb/host-gitconfig:ro`);
    expect(argv.join(" ")).not.toContain("/root/.gitconfig");
    const content = readFileSync(guestGitconfigTempPath("p"), "utf8");
    expect(content).toContain("[include]");
    expect(content).toContain("path = /etc/mise-msb/host-gitconfig");
    // Pinned entries follow the include so they override inherited config.
    expect(content.indexOf("[include]")).toBeLessThan(content.indexOf("[gpg]"));
  });

  test("signing pins the supplied committer identity into the generated gitconfig", () => {
    buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({ signing: { enabled: true, key: SIGNING_KEY } }),
      gitIdentity: { name: "Ada Lovelace", email: "ada@example.com" },
    });
    const content = readFileSync(guestGitconfigTempPath("p"), "utf8");
    expect(content).toContain("    name = Ada Lovelace\n");
    expect(content).toContain("    email = ada@example.com\n");
    expect(content).toContain("    signingkey = /etc/mise-msb/signing/id_ed25519_sandbox.pub\n");
    // Identity sits under [user] alongside the signing key.
    expect(content.indexOf("name = Ada Lovelace")).toBeGreaterThan(content.indexOf("[user]"));
    expect(content.indexOf("signingkey")).toBeGreaterThan(content.indexOf("[user]"));
  });
});

describe("generateGuestGitconfig", () => {
  test("include present only when a host gitconfig mount is configured", () => {
    expect(generateGuestGitconfig(true)).toBe(
      "[include]\n" +
      "    path = /etc/mise-msb/host-gitconfig\n" +
      "[gpg]\n" +
      "    format = ssh\n" +
      "[user]\n" +
      "    signingkey = /etc/mise-msb/signing/id_ed25519_sandbox.pub\n" +
      "[commit]\n" +
      "    gpgsign = true\n",
    );
    expect(generateGuestGitconfig(false)).toBe(
      "[gpg]\n" +
      "    format = ssh\n" +
      "[user]\n" +
      "    signingkey = /etc/mise-msb/signing/id_ed25519_sandbox.pub\n" +
      "[commit]\n" +
      "    gpgsign = true\n",
    );
  });

  test("identity entries are pinned when supplied", () => {
    expect(generateGuestGitconfig(false, { name: "Ada", email: "ada@example.com" })).toBe(
      "[gpg]\n" +
      "    format = ssh\n" +
      "[user]\n" +
      "    name = Ada\n" +
      "    email = ada@example.com\n" +
      "    signingkey = /etc/mise-msb/signing/id_ed25519_sandbox.pub\n" +
      "[commit]\n" +
      "    gpgsign = true\n",
    );
  });

  test("identity values cannot break out of a line", () => {
    const content = generateGuestGitconfig(false, { name: "a\n[evil]\nb = c", email: "x@y.z" });
    expect(content).toContain("name = a [evil] b = c");
    expect(content).not.toContain("[evil]\n");
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

describe("print mode: secret bridges", () => {
  test("differing names show literal $MSB_ placeholder, not value", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        secrets: {
          OPENCODE_API_KEY: {
            from: "OPENCODE_API_KEY_PERSONAL",
            hosts: ["opencode.ai"],
          },
        },
      }),
    });
    const formatted = formatArgv(argv);
    // The $MSB_ placeholder may be shell-quoted in print mode; check the
    // raw argv for the exact substring.
    expect(argv).toContain("OPENCODE_API_KEY=$MSB_OPENCODE_API_KEY_PERSONAL");
    expect(formatted).toContain("$MSB_OPENCODE_API_KEY_PERSONAL");
    expect(formatted).toContain("--secret OPENCODE_API_KEY_PERSONAL@opencode.ai");
    // No value should be present.
    expect(formatted).not.toContain("sk-");
  });

  test("same-name print mode omits bridge, keeps --secret source@host", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        secrets: {
          SERVICE_TOKEN: { from: "SERVICE_TOKEN", hosts: ["api.example"] },
        },
      }),
    });
    const formatted = formatArgv(argv);
    expect(formatted).toContain("--secret SERVICE_TOKEN@api.example");
    expect(argv.join(" ")).not.toContain("$MSB_");
  });

  test("print mode: env/secret overlap keeps bridge and drops the literal value", () => {
    const argv = buildCreateArgv({
      image: "p:dev",
      name: "p",
      config: baseConfig({
        env: { OPENCODE_API_KEY: "literal-env-value" },
        secrets: {
          OPENCODE_API_KEY: {
            from: "OPENCODE_API_KEY_PERSONAL",
            hosts: ["opencode.ai"],
          },
        },
      }),
    });
    const formatted = formatArgv(argv);
    expect(formatted).toContain("$MSB_OPENCODE_API_KEY_PERSONAL");
    expect(formatted).not.toContain("literal-env-value");
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
