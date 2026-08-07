import { afterEach, describe, expect, test } from "bun:test";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HELPER = resolve(import.meta.dir, "../src/stock-image/mise-msb-bootstrap");
const CA_DIR = "/usr/local/share/ca-certificates";
// Test seam in the helper: points the browser-trust scan at another directory
// so the empty-CA scenario runs without depending on the shared host CA dir.
const CA_DIR_OVERRIDE_ENV = "MISE_MSB_CA_DIR";

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runBrowserTrust(home: string, caDir?: string): SpawnResult {
  const proc = Bun.spawnSync(["bash", HELPER, "browser-trust"], {
    env: {
      ...process.env,
      HOME: home,
      ...(caDir !== undefined ? { [CA_DIR_OVERRIDE_ENV]: caDir } : {}),
    },
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function certutil(...args: string[]): SpawnResult {
  const proc = Bun.spawnSync(["certutil", ...args]);
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function listNicknames(dbDir: string): string[] {
  const res = certutil("-L", "-d", `sql:${dbDir}`);
  expect(res.exitCode).toBe(0);
  return res.stdout
    .split("\n")
    .map((line) => line.match(/^(\S+)\s{2,}/)?.[1])
    .filter((nick): nick is string => nick !== undefined && nick !== "Nickname");
}

function makeCert(cn: string, dest: string): void {
  const proc = Bun.spawnSync(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      "/dev/null",
      "-out",
      dest,
      "-days",
      "1",
      "-nodes",
      "-subj",
      `/CN=${cn}`,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  expect(proc.exitCode).toBe(0);
}

function sha256Fingerprint(certPath: string): string {
  const proc = Bun.spawnSync([
    "openssl",
    "x509",
    "-in",
    certPath,
    "-noout",
    "-fingerprint",
    "-sha256",
  ]);
  expect(proc.exitCode).toBe(0);
  return proc.stdout.toString().trim().split("=")[1]!;
}

// A fixture is self-cleaning: the tmp HOME is removed, and every
// mise-msb-test-*.crt written into the shared CA dir is removed.
interface Fixture {
  home: string;
  modernDb: string;
  legacyDb: string;
  writeCert(name: string, cn?: string): string;
}

let fixtureHomes: string[] = [];

function makeFixture(tag: string): Fixture {
  const home = join(tmpdir(), `browser-trust-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(home, { recursive: true });
  fixtureHomes.push(home);
  return {
    home,
    modernDb: join(home, ".local", "share", "pki", "nssdb"),
    legacyDb: join(home, ".pki", "nssdb"),
    writeCert(name: string, cn = name): string {
      const path = join(CA_DIR, `${name}.crt`);
      makeCert(cn, path);
      return path;
    },
  };
}


const caDirWritable = (() => {
  try {
    accessSync(CA_DIR, constants.W_OK);
    return true;
  } catch {
    return false;
  }
})();

// The CA dir is shared with the host (e.g. microsandbox-ca.crt); tests only
// ever write and delete mise-msb-test-*.crt files.
const describeCa = caDirWritable ? describe : describe.skip;

afterEach(() => {
  for (const home of fixtureHomes) {
    rmSync(home, { recursive: true, force: true });
  }
  fixtureHomes = [];
  if (caDirWritable) {
    for (const entry of readdirSync(CA_DIR)) {
      if (/^mise-msb-test-.*\.crt$/.test(entry)) {
        rmSync(join(CA_DIR, entry), { force: true });
      }
    }
  }
});

describeCa("mise-msb-bootstrap browser-trust", () => {
  test("fresh HOME selects and creates the modern NSS db", () => {
    const fx = makeFixture("modern");
    fx.writeCert("mise-msb-test-modern");

    const res = runBrowserTrust(fx.home);
    expect(res.exitCode).toBe(0);
    expect(existsSync(fx.modernDb)).toBe(true);
    expect(existsSync(join(fx.modernDb, "cert9.db"))).toBe(true);
    expect(listNicknames(fx.modernDb)).toContain("mise-msb-local-ca-mise-msb-test-modern");
  });

  test("pre-existing legacy db wins over the modern location", () => {
    const fx = makeFixture("legacy");
    mkdirSync(fx.legacyDb, { recursive: true });
    expect(certutil("-N", "--empty-password", "-d", `sql:${fx.legacyDb}`).exitCode).toBe(0);
    fx.writeCert("mise-msb-test-legacy");

    const res = runBrowserTrust(fx.home);
    expect(res.exitCode).toBe(0);
    expect(listNicknames(fx.legacyDb)).toContain("mise-msb-local-ca-mise-msb-test-legacy");
    expect(existsSync(fx.modernDb)).toBe(false);
  });

  test("unrelated db entries are preserved", () => {
    const fx = makeFixture("preserve");
    mkdirSync(fx.legacyDb, { recursive: true });
    expect(certutil("-N", "--empty-password", "-d", `sql:${fx.legacyDb}`).exitCode).toBe(0);
    // The pre-seeded personal entry must be a DIFFERENT certificate than the
    // one the helper imports: NSS keys certificates by (issuer, serial), so
    // re-importing the same DER under the wrapper nickname would just retitle
    // the existing entry instead of adding a new one.
    const personal = join(fx.home, "personal.crt");
    makeCert("personal-entry", personal);
    expect(
      certutil("-A", "-n", "personal-entry", "-t", "P,,", "-i", personal, "-d", `sql:${fx.legacyDb}`)
        .exitCode,
    ).toBe(0);
    fx.writeCert("mise-msb-test-preserve");

    const res = runBrowserTrust(fx.home);
    expect(res.exitCode).toBe(0);
    const nicknames = listNicknames(fx.legacyDb);
    expect(nicknames).toContain("personal-entry");
    expect(nicknames).toContain("mise-msb-local-ca-mise-msb-test-preserve");
  });

  test("repeat execution converges without duplicate entries", () => {
    const fx = makeFixture("repeat");
    fx.writeCert("mise-msb-test-repeat");

    expect(runBrowserTrust(fx.home).exitCode).toBe(0);
    expect(runBrowserTrust(fx.home).exitCode).toBe(0);

    const nicknames = listNicknames(fx.modernDb);
    expect(nicknames.filter((n) => n === "mise-msb-local-ca-mise-msb-test-repeat")).toHaveLength(1);
  });

  test("rotating cert content under the same filename re-imports the new cert", () => {
    const fx = makeFixture("rotate");
    const certPath = fx.writeCert("mise-msb-test-rotate", "mise-msb-test-rotate-a");
    expect(runBrowserTrust(fx.home).exitCode).toBe(0);
    const fpA = sha256Fingerprint(certPath);

    makeCert("mise-msb-test-rotate-b", certPath);
    expect(runBrowserTrust(fx.home).exitCode).toBe(0);
    const fpB = sha256Fingerprint(certPath);
    expect(fpB).not.toBe(fpA);

    const shown = certutil("-L", "-n", "mise-msb-local-ca-mise-msb-test-rotate", "-d", `sql:${fx.modernDb}`);
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain(fpB);
    expect(shown.stdout).not.toContain(fpA);
  });

  test("helper source guards the empty CA dir case", () => {
    const source = readFileSync(HELPER, "utf8");
    expect(source).toContain("nothing to do");
    expect(source).toContain("*.crt");
  });

  test("malformed cert fails with cert path, db path, and prefix in stderr", () => {
    const fx = makeFixture("bad");
    const badPath = join(CA_DIR, "mise-msb-test-bad.crt");
    writeFileSync(badPath, "this is not a certificate\n");

    const res = runBrowserTrust(fx.home);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain("mise-msb-bootstrap: browser-trust:");
    expect(res.stderr).toContain(badPath);
    expect(res.stderr).toContain(fx.modernDb);
  });

  test("un-creatable db dir fails with the db path in stderr", () => {
    const fx = makeFixture("blocked");
    // A regular file where the db directory must be created: mkdir -p fails
    // (set -e) after the helper's error message names the db path.
    mkdirSync(join(fx.home, ".local", "share", "pki"), { recursive: true });
    writeFileSync(fx.modernDb, "blocked");
    fx.writeCert("mise-msb-test-blocked");

    const res = runBrowserTrust(fx.home);
    // mkdir's own stderr names the blocked db path; the helper dies via set -e
    // before its certutil -N message.
    expect(res.stderr).toContain(fx.modernDb);
    expect(res.exitCode).not.toBe(0);
  });
});

// The empty-CA scenario is hermetic: it drives the helper through the
// CA_DIR_OVERRIDE_ENV seam at a fresh empty directory, so it never reads or
// mutates the shared host CA dir and runs in every environment.
describe("mise-msb-bootstrap browser-trust empty CA dir", () => {
  test("empty CA dir is a successful no-op", () => {
    const fx = makeFixture("empty");
    const emptyCaDir = join(fx.home, "empty-ca");
    mkdirSync(emptyCaDir, { recursive: true });

    const res = runBrowserTrust(fx.home, emptyCaDir);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("browser-trust");
    expect(res.stdout).toContain("nothing to do");
    expect(res.stdout).toContain(emptyCaDir);
    expect(existsSync(fx.modernDb)).toBe(false);
  });
});

if (!caDirWritable) {
  console.log(`browser-trust tests skipped: ${CA_DIR} is not writable`);
}
