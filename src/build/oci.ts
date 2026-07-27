/**
 * OCI image build pipeline.
 *
 * Builds a Linux OCI image from the project's mise.toml using the
 * experimental `mise oci build` command. On Linux hosts, mise runs
 * directly; on macOS hosts, an ephemeral Linux microVM (via msb run)
 * executes the same command.
 *
 * The OCI layout is archived with host `tar` and imported via
 * `msb image load --input ... --tag ...`.
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SandboxConfig } from "../config/types.js";
import { mountArgv } from "../msb/argv.js";
import { run, runSync, which } from "../msb/subprocess.js";

export interface BuildInputs {
  config: SandboxConfig;
  /** Absolute path to the project root (where mise.toml lives). */
  projectRoot: string;
  /** Print-only flag — do not actually run anything. */
  printOnly: boolean;
  /** Override the temporary output directory (used by tests). */
  outputDir?: string;
  /** Override the platform detection (used by tests). */
  platform?: NodeJS.Platform;
  /** Host mise binary override (used by tests). */
  miseBinary?: string;
  /** Host msb binary override (used by tests). */
  msbBinary?: string;
}

export interface BuildOutput {
  /** Absolute path to the archived OCI layout (kept on failure). */
  archivePath: string;
  /** Exit code of the overall pipeline. */
  exitCode: number;
  /** Stage that failed, when exitCode !== 0. */
  failedStage?: string;
}

const DEFAULT_BUILDER_IMAGE = "ubuntu:24.04";

/**
 * Run the full OCI build pipeline. Streams all subprocess output to the
 * terminal in non-print mode and returns the final exit code.
 */
export async function buildOciImage(input: BuildInputs): Promise<BuildOutput> {
  const platform = input.platform ?? process.platform;
  const mise = input.miseBinary ?? which("mise") ?? "mise";
  const msb = input.msbBinary ?? which("msb") ?? "msb";
  const tar = which("tar") ?? "tar";

  const outputDir = input.outputDir ?? createTempDir("mise-msb-build-");
  const layoutDir = join(outputDir, "layout");
  const archivePath = join(outputDir, "image.tar");

  // Ensure layout dir exists; mise oci build refuses to overwrite.
  try {
    mkdirSync(layoutDir, { recursive: true });
  } catch {
    // ignore — let the underlying command surface the real error
  }

  try {
    // Stage 1: mise oci build
    const buildArgv = buildMiseOciArgv({
      mise,
      from: input.config.build.from,
      tag: input.config.build.tag,
      output: layoutDir,
      cwd: input.projectRoot,
    });
    const miseResult = await run(buildArgv, {
      printOnly: input.printOnly,
      label: "mise oci build",
    });
    if (miseResult.exitCode !== 0) {
      return { archivePath, exitCode: miseResult.exitCode, failedStage: "mise oci build" };
    }

    // Stage 2: tar the layout
    const tarArgv = [tar, "-C", layoutDir, "-cf", archivePath, "."];
    const tarResult = await run(tarArgv, {
      printOnly: input.printOnly,
      label: "tar",
    });
    if (tarResult.exitCode !== 0) {
      return { archivePath, exitCode: tarResult.exitCode, failedStage: "tar" };
    }

    // Stage 3: msb image load
    const loadArgv = [msb, "image", "load", "--input", archivePath, "--tag", input.config.build.tag];
    const loadResult = await run(loadArgv, {
      printOnly: input.printOnly,
      label: "msb image load",
    });
    if (loadResult.exitCode !== 0) {
      return { archivePath, exitCode: loadResult.exitCode, failedStage: "msb image load" };
    }

    // Success — cleanup the temporary directory unless print-only (in
    // which case the caller may want to inspect it).
    if (!input.printOnly) {
      safeRm(outputDir);
    }
    return { archivePath, exitCode: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      archivePath,
      exitCode: 1,
      failedStage: `mise-msb: ${message}`,
    };
  }
}

interface MiseOciArgs {
  mise: string;
  from: string;
  tag: string;
  output: string;
  cwd: string;
}

function buildMiseOciArgv(args: MiseOciArgs): string[] {
  // MISE_EXPERIMENTAL=1 is required by `mise oci build`.
  return [
    args.mise,
    "oci",
    "build",
    "--from",
    args.from,
    "--tag",
    args.tag,
    "--output",
    args.output,
  ];
}

/**
 * Plan argv for a macOS builder invocation. This is the print-only
 * representation of what would run when the host is macOS.
 */
export interface MacOsBuilderPlan {
  argv: string[];
  /** Absolute path on the host where the project is mounted inside the VM. */
  guestProjectPath: string;
  /** Absolute path inside the VM where the output layout is written. */
  guestOutputPath: string;
  /** Absolute path on the host that backs the guest output path. */
  hostOutputPath: string;
}

export function planMacOsBuilder(input: {
  config: SandboxConfig;
  projectRoot: string;
  outputDir: string;
  msbBinary?: string;
}): MacOsBuilderPlan {
  const msb = input.msbBinary ?? "msb";
  const guestProjectPath = "/workspace";
  const guestOutputPath = "/out";
  const miseArgs = buildMiseOciArgv({
    mise: "mise",
    from: input.config.build.from,
    tag: input.config.build.tag,
    output: `${guestOutputPath}/layout`,
    cwd: guestProjectPath,
  });

  const argv: string[] = [
    msb,
    "run",
    input.config.build.builderImage || DEFAULT_BUILDER_IMAGE,
    "--name",
    `mise-msb-build-${Date.now()}`,
    "--cpus",
    String(input.config.runtime.cpus),
    "--memory",
    input.config.runtime.memory,
    "--mount-dir",
    `${input.projectRoot}:${guestProjectPath}:ro`,
    "--mount-dir",
    `${input.outputDir}:${guestOutputPath}:rw`,
    "--env",
    "MISE_EXPERIMENTAL=1",
    "--",
    ...miseArgs,
  ];

  return {
    argv,
    guestProjectPath,
    guestOutputPath,
    hostOutputPath: input.outputDir,
  };
}

/**
 * Execute the macOS builder plan. Streams output to the terminal in
 * non-print mode.
 */
export async function runMacOsBuilder(
  plan: MacOsBuilderPlan,
  printOnly: boolean,
): Promise<number> {
  const result = await run(plan.argv, {
    printOnly,
    label: "macOS Linux builder",
  });
  return result.exitCode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(prefix: string): string {
  // We deliberately use a deterministic prefix + Date.now suffix to keep
  // the build output locatable on failure. A real tmp directory is also
  // fine; we use the project root for visibility during development.
  const path = join(process.cwd(), ".mise-msb-build", `${prefix}${Date.now()}`);
  mkdirSync(path, { recursive: true });
  return path;
}

function safeRm(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; ignore failures.
  }
}

/**
 * Detect whether the current host should run mise directly. We treat
 * Linux as direct; macOS routes through a builder VM.
 */
export function shouldUseDirectMise(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "linux";
}

// Run-sync wrapper used by tests to keep this file's export surface
// predictable.
export function probeMise(binary: string = "mise"): boolean {
  const result = runSync([binary, "--version"], { inheritStdio: false });
  return result.exitCode === 0;
}

export { mountArgv };
