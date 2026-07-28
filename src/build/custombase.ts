/**
 * Optional personal Containerfile base construction.
 *
 * When `~/.config/mise-msb/image/Containerfile` exists, the build pipeline
 * builds that Containerfile locally with Docker, saves it to a tar archive,
 * and hands the resulting base to `mise oci build` inside the builder VM.
 * The handoff happens entirely inside the VM: a temporary loopback OCI
 * registry receives the base via `skopeo copy`, then `mise oci build` reads
 * it from `localhost:5000`. Nothing is pushed to an external registry and
 * no host-network access is required.
 *
 * This module owns: discovery, calendar-version parsing/preflight, the
 * host-side Docker build + save, and the per-build state that carries the
 * tar path and registry tag through the pipeline.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { personalImageDirPath } from "../config/loader.js";
import { run, runCapture, type SpawnOptions } from "../msb/subprocess.js";

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Absolute path of the optional personal Containerfile. */
export function personalContainerfilePath(homeDir: string = homedir()): string {
  return join(personalImageDirPath(homeDir), "Containerfile");
}

export interface PersonalImage {
  /** Absolute path of the personal Containerfile. */
  containerfile: string;
  /** Absolute path of its containing directory — the isolated build context. */
  contextDir: string;
}

/**
 * Discover the optional personal Containerfile. Returns `null` when the
 * conventional file is absent, leaving the build on the Docker-free
 * `build.from` path.
 */
export function discoverPersonalContainerfile(homeDir: string = homedir()): PersonalImage | null {
  const containerfile = personalContainerfilePath(homeDir);
  if (!existsSync(containerfile)) return null;
  return { containerfile, contextDir: personalImageDirPath(homeDir) };
}

// ---------------------------------------------------------------------------
// Calendar-version parsing
// ---------------------------------------------------------------------------

/** Calendar version `YYYY.M.D` (numeric components). */
export interface CalVer {
  major: number;
  minor: number;
  patch: number;
  /** The raw version string this was parsed from (preserved for errors). */
  raw: string;
}

/** Minimum Linux mise version that supports the custom-base pipeline. */
export const MIN_MISE_VERSION: CalVer = { major: 2026, minor: 7, patch: 12, raw: "2026.7.12" };

const CALVER_RE = /(\d{4})\.(\d{1,2})\.(\d{1,2})/;

/**
 * Parse the leading calendar version from raw `mise --version` output.
 * Throws with the raw output preserved when no calendar version is found.
 * On success, `raw` is the matched version string (e.g. `2026.7.12`).
 */
export function parseMiseVersion(rawOutput: string): CalVer {
  const match = CALVER_RE.exec(rawOutput);
  if (match === null) {
    throw new Error(
      `could not parse a calendar version from mise output: ${JSON.stringify(rawOutput)}`,
    );
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return { major, minor, patch, raw: match[0] };
}

/** Compare two calendar versions: negative if a < b, zero if equal, positive if a > b. */
export function compareCalVer(a: CalVer, b: CalVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** True when `actual` is greater than or equal to `minimum`. */
export function meetsMinimum(actual: CalVer, minimum: CalVer): boolean {
  return compareCalVer(actual, minimum) >= 0;
}

// ---------------------------------------------------------------------------
// Custom-base state
// ---------------------------------------------------------------------------

/**
 * Per-build custom-base state. Carries the unique runtime identifiers, the
 * host-side tar path, and the registry tag the VM will consume.
 */
export interface CustomBaseState {
  /** Unique per-build identifier. */
  buildId: string;
  /** Docker tag used for the host-side build. */
  dockerTag: string;
  /** Host path of the saved tar archive (mounted into the VM). */
  baseTarPath: string;
  /** Registry tag the VM uses: `localhost:5000/mise-msb/base:<buildId>`. */
  registryTag: string;
  /** Base reference for `mise oci build --from`. */
  baseRef: string;
  /** True once the host-side Docker build + save succeeded. */
  built: boolean;
}

/** Allocate a fresh, unique custom-base state for a build. */
export function createCustomBaseState(buildId: string, outputDir: string): CustomBaseState {
  const dockerTag = `mise-msb-base:${buildId}`;
  const baseTarPath = join(outputDir, "base.tar");
  const registryTag = `localhost:5000/mise-msb/base:${buildId}`;
  return {
    buildId,
    dockerTag,
    baseTarPath,
    registryTag,
    baseRef: registryTag,
    built: false,
  };
}

/** Generate a unique per-build identifier. */
export function generateBuildId(): string {
  const rand = randomBytes(4).toString("hex");
  return `${Date.now().toString(36)}-${rand}`;
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export interface PreflightInput {
  platform: NodeJS.Platform;
  /** Host mise binary path (Linux preflight). */
  miseBinary: string;
  /** Host msb binary path (macOS builder preflight). */
  msbBinary: string;
  /** Configured Linux builder image (macOS preflight). */
  builderImage: string;
  /** Resolved docker binary path, or null when not on PATH. */
  dockerBinary: string | null;
  /** When true, do not run anything — return success. */
  printOnly: boolean;
}

export interface PreflightResult {
  exitCode: number;
  failedStage?: string;
  /** Human-readable detail for actionable failures. */
  message?: string;
}

/**
 * Custom-base preflight: require Docker, then validate the Linux mise that
 * will execute `mise oci build`. On Linux that is the host mise; on macOS it
 * is mise inside the configured builder image. Host macOS mise is never
 * inspected. Completes before the registry starts or Docker builds.
 */
export async function preflightCustomBase(input: PreflightInput): Promise<PreflightResult> {
  if (input.printOnly) return { exitCode: 0 };

  if (input.dockerBinary === null) {
    return {
      exitCode: 1,
      failedStage: "docker not found",
      message:
        "the docker CLI is required to build a personal Containerfile base; install Docker or remove ~/.config/mise-msb/image/Containerfile to use build.from",
    };
  }

  const versionArgv =
    input.platform === "darwin"
      ? [input.msbBinary, "run", input.builderImage, "--", "mise", "--version"]
      : [input.miseBinary, "--version"];

  const label = input.platform === "darwin" ? "mise version preflight (builder)" : "mise version preflight";
  const captured = await runCapture(versionArgv, { label });
  if (captured.exitCode !== 0) {
    return {
      exitCode: captured.exitCode,
      failedStage: label,
      message: `mise --version probe failed (exit ${captured.exitCode})${captured.stderr.length > 0 ? `: ${captured.stderr.trim()}` : ""}`,
    };
  }

  let actual: CalVer;
  try {
    actual = parseMiseVersion(captured.stdout);
  } catch (err) {
    return {
      exitCode: 1,
      failedStage: label,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (!meetsMinimum(actual, MIN_MISE_VERSION)) {
    const where =
      input.platform === "darwin"
        ? `build.builderImage (${input.builderImage})`
        : "host mise";
    return {
      exitCode: 1,
      failedStage: label,
      message: `${where} is mise ${actual.raw}; custom-base builds require mise >=${MIN_MISE_VERSION.raw} (the Linux process running mise oci build needs insecure-registry support)`,
    };
  }

  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Host-side Docker build + save
// ---------------------------------------------------------------------------

export interface StageResult {
  exitCode: number;
  failedStage?: string;
  /** Human-readable detail for actionable failures. */
  message?: string;
}

/**
 * Build the personal Containerfile with its isolated image-directory context
 * and save it to a tar archive for transfer into the builder VM.
 */
export async function buildAndSaveBase(
  state: CustomBaseState,
  docker: string,
  containerfile: string,
  contextDir: string,
  options: SpawnOptions = {},
): Promise<StageResult> {
  const buildArgv = [
    docker,
    "build",
    "--load",
    "-f",
    containerfile,
    "-t",
    state.dockerTag,
    contextDir,
  ];
  const built = await run(buildArgv, { ...options, label: "Containerfile build" });
  if (built.exitCode !== 0) {
    return { exitCode: built.exitCode, failedStage: "Containerfile build" };
  }

  const saveArgv = [docker, "save", "-o", state.baseTarPath, state.dockerTag];
  const saved = await run(saveArgv, { ...options, label: "docker save" });
  if (saved.exitCode !== 0) {
    return { exitCode: saved.exitCode, failedStage: "docker save" };
  }

  state.built = true;
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// In-VM handoff script
// ---------------------------------------------------------------------------

/**
 * Build the shell script that runs inside the builder VM to start a
 * loopback registry, import the base tar via skopeo, and then run
 * `mise oci build` against it. Everything happens on `localhost:5000`
 * inside the VM — no host-network access is required.
 *
 * @param baseTarGuestPath  Where the base tar is mounted inside the VM.
 * @param registryTag       The tag to push to, e.g. `localhost:5000/mise-msb/base:<id>`.
 * @param miseOciArgv       The `mise oci build` argv (without the leading env).
 */
export function buildVmHandoffScript(
  baseTarGuestPath: string,
  registryTag: string,
  miseOciArgv: string[],
  /** Guest path where the project (mise.toml) is mounted. */
  guestProjectPath: string,
): string {
  const miseCmd = miseOciArgv.map(shellQuote).join(" ");
  return [
    "set -euo pipefail",
    "",
    "# Start a temporary loopback registry inside the VM.",
    "registry serve /etc/registry/config.yml &",
    "REGISTRY_PID=$!",
    '# Always stop the registry on exit (success or failure).',
    "trap 'kill $REGISTRY_PID 2>/dev/null || true' EXIT",
    "",
    "# Wait for the registry to become ready.",
    "for i in $(seq 1 30); do",
    '  if curl -sf http://127.0.0.1:5000/v2/ >/dev/null 2>&1; then',
    "    break",
    "  fi",
    "  sleep 0.2",
    "done",
    'curl -sf http://127.0.0.1:5000/v2/ >/dev/null || { echo "registry did not start" >&2; exit 1; }',
    "",
    "# Import the base tar into the local registry via skopeo.",
    `skopeo copy --dest-tls-verify=false --insecure-policy "docker-archive:${baseTarGuestPath}" "docker://${registryTag}"`,
    "",
    "# Trust the project mise.toml, install tools, and run mise oci build.",
    `cd ${shellQuote(guestProjectPath)}`,
    "mise trust 2>/dev/null || true",
    "# Use --locked so mise doesn't try to write the lockfile to the read-only project mount.",
    "mise install --locked || mise install",
    `MISE_EXPERIMENTAL=1 ${miseCmd}`,
  ].join("\n");
}

/** Minimal POSIX shell quoting for a single argument. */
function shellQuote(s: string): string {
  if (s.length === 0) return "''";
  if (/^[A-Za-z0-9_./:=@,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
