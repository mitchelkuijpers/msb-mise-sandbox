/**
 * OCI image build pipeline.
 *
 * Builds a Linux OCI image from the project's mise.toml using the
 * experimental `mise oci build` command. On Linux hosts, mise runs
 * directly; on macOS hosts, an ephemeral Linux microVM (via msb run)
 * executes the same command.
 *
 * The pipeline is split into a platform-specific layout-production stage
 * (mise runs exactly once) and shared archive + `msb image load` stages.
 * When an optional personal Containerfile is present, the wrapper builds
 * it on the host with Docker, saves it to a tar, and runs the entire
 * handoff (registry + skopeo + mise oci build) inside the builder VM on
 * `localhost:5000`. No host-network access or external registry push is
 * required. Otherwise the configured `build.from` is used directly and the
 * workflow stays Docker-free.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { SandboxConfig } from "../config/types.js";
import { mountArgv } from "../msb/argv.js";
import { run, runSync, which } from "../msb/subprocess.js";
import {
  buildAndSaveBase,
  buildVmHandoffScript,
  createCustomBaseState,
  discoverPersonalContainerfile,
  generateBuildId,
  preflightCustomBase,
  type CustomBaseState,
  type PersonalImage,
} from "./custombase.js";

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
  /** Explicit personal Containerfile path — activates custom-base mode. */
  containerfile?: string;
  /** Explicit Docker build context dir (defaults to the Containerfile's directory). */
  contextDir?: string;
  /** Discover the personal Containerfile from the user config dir. */
  discoverContainerfile?: boolean;
  /** Override home dir for discovery (used by tests). */
  homeDir?: string;
  /** Override docker binary; `null` forces "docker not found" (used by tests). */
  dockerBinary?: string | null;
}

export interface BuildOutput {
  /** Absolute path to the archived OCI layout (kept on failure). */
  archivePath: string;
  /** Exit code of the overall pipeline. */
  exitCode: number;
  /** Stage that failed, when exitCode !== 0. */
  failedStage?: string;
  /** Human-readable detail for actionable failures. */
  message?: string;
}

const DEFAULT_BUILDER_IMAGE = "ubuntu:24.04";

/**
 * Run the full OCI build pipeline. Streams all subprocess output to the
 * terminal in non-print mode and returns the final exit code. When a
 * personal Containerfile is discovered (or supplied), builds it on the
 * host, saves to tar, and runs the handoff + mise oci build inside the VM;
 * otherwise uses the configured `build.from` directly without Docker.
 */
export async function runBuildPipeline(input: BuildInputs): Promise<BuildOutput> {
  const platform = input.platform ?? process.platform;
  const mise = input.miseBinary ?? which("mise") ?? "mise";
  const msb = input.msbBinary ?? which("msb") ?? "msb";
  const tar = which("tar") ?? "tar";
  const docker = input.dockerBinary !== undefined ? input.dockerBinary : which("docker");

  const outputDir = input.outputDir ?? createTempDir("mise-msb-build-");
  const layoutDir = join(outputDir, "layout");
  const archivePath = join(outputDir, "image.tar");

  // Ensure layout dir exists; mise oci build refuses to overwrite.
  try {
    mkdirSync(layoutDir, { recursive: true });
  } catch {
    // ignore — let the underlying command surface the real error
  }

  // Resolve custom-base mode.
  let custom: PersonalImage | null = null;
  if (input.containerfile !== undefined) {
    custom = {
      containerfile: input.containerfile,
      contextDir: input.contextDir ?? dirname(input.containerfile),
    };
  } else if (input.discoverContainerfile) {
    custom = discoverPersonalContainerfile(input.homeDir ?? homedir());
  }
  const useCustomBase = custom !== null;
  const state: CustomBaseState | null = useCustomBase
    ? createCustomBaseState(generateBuildId(), outputDir)
    : null;

  let primaryExit = 0;
  let failedStage: string | undefined;
  let message: string | undefined;

  // Stage 1: custom-base preflight + host-side Docker build + save.
  if (useCustomBase && state !== null && custom !== null) {
    const pre = await preflightCustomBase({
      platform,
      miseBinary: mise,
      msbBinary: msb,
      builderImage: input.config.build.builderImage || DEFAULT_BUILDER_IMAGE,
      dockerBinary: docker,
      printOnly: input.printOnly,
    });
    if (pre.exitCode !== 0) {
      primaryExit = pre.exitCode;
      failedStage = pre.failedStage;
      message = pre.message;
    }

    if (primaryExit === 0 && docker !== null) {
      const base = await buildAndSaveBase(
        state,
        docker,
        custom.containerfile,
        custom.contextDir,
        { printOnly: input.printOnly },
      );
      if (base.exitCode !== 0) {
        primaryExit = base.exitCode;
        failedStage = base.failedStage;
      }
    }
  }

  // Stage 2: produce the OCI layout (mise runs exactly once).
  if (primaryExit === 0) {
    const from = useCustomBase && state !== null ? state.baseRef : input.config.build.from;
    const layout = await produceOciLayout({
      platform,
      mise,
      msb,
      config: input.config,
      projectRoot: input.projectRoot,
      outputDir,
      layoutDir,
      from,
      printOnly: input.printOnly,
      customBase: useCustomBase ? state : null,
    });
    if (layout.exitCode !== 0) {
      primaryExit = layout.exitCode;
      failedStage = layout.failedStage;
    }
  }

  // Stage 3: archive the layout and load into msb.
  if (primaryExit === 0) {
    const al = await archiveAndLoad({
      tar,
      msb,
      layoutDir,
      archivePath,
      tag: input.config.build.tag,
      printOnly: input.printOnly,
    });
    if (al.exitCode !== 0) {
      primaryExit = al.exitCode;
      failedStage = al.failedStage;
    }
  }

  // Success — cleanup the temporary directory unless print-only (in which
  // case the caller may want to inspect it). Failed layout/import stages
  // preserve the diagnostic artifacts per the existing contract.
  if (primaryExit === 0 && !input.printOnly) {
    safeRm(outputDir);
  }
  return { archivePath, exitCode: primaryExit, failedStage, message };
}

/**
 * Backward-compatible entry point: the no-custom-base pipeline. Existing
 * callers and tests use this; the build command uses {@link runBuildPipeline}
 * with discovery enabled.
 */
export async function buildOciImage(input: BuildInputs): Promise<BuildOutput> {
  return runBuildPipeline({ ...input, discoverContainerfile: false, containerfile: undefined });
}

// ---------------------------------------------------------------------------
// Layout production (platform-specific; mise runs exactly once)
// ---------------------------------------------------------------------------

export interface ProduceLayoutInput {
  platform: NodeJS.Platform;
  mise: string;
  msb: string;
  config: SandboxConfig;
  projectRoot: string;
  outputDir: string;
  layoutDir: string;
  /** Effective base reference (`build.from` or the custom-base registry tag). */
  from: string;
  printOnly: boolean;
  /** Custom-base state — when present, the in-VM handoff script is used. */
  customBase?: CustomBaseState | null;
}

export interface LayoutResult {
  /** Host path of the produced OCI layout. */
  layoutDir: string;
  exitCode: number;
  failedStage?: string;
}

/**
 * Produce the OCI layout by running `mise oci build` exactly once. On Linux
 * mise runs directly; on macOS the same command runs inside a Linux builder
 * microVM. When `customBase` is present, the VM also starts a loopback
 * registry and imports the base tar via skopeo before running mise.
 */
export async function produceOciLayout(input: ProduceLayoutInput): Promise<LayoutResult> {
  if (shouldUseDirectMise(input.platform)) {
    const buildArgv = buildMiseOciArgv({
      mise: input.mise,
      from: input.from,
      tag: input.config.build.tag,
      output: input.layoutDir,
      cwd: input.projectRoot,
    });
    const result = await run(buildArgv, { printOnly: input.printOnly, label: "mise oci build" });
    if (result.exitCode !== 0) {
      return { layoutDir: input.layoutDir, exitCode: result.exitCode, failedStage: "mise oci build" };
    }
    return { layoutDir: input.layoutDir, exitCode: 0 };
  }

  const plan = planMacOsBuilder({
    config: input.config,
    projectRoot: input.projectRoot,
    outputDir: input.outputDir,
    msbBinary: input.msb,
    from: input.from,
    customBase: input.customBase ?? null,
  });
  const exit = await runMacOsBuilder(plan, input.printOnly);
  if (exit !== 0) {
    return { layoutDir: input.layoutDir, exitCode: exit, failedStage: "macOS Linux builder" };
  }
  return { layoutDir: input.layoutDir, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Shared archive + load stages
// ---------------------------------------------------------------------------

export interface ArchiveInput {
  tar: string;
  msb: string;
  layoutDir: string;
  archivePath: string;
  tag: string;
  printOnly: boolean;
}

export interface ArchiveResult {
  exitCode: number;
  failedStage?: string;
}

/** Archive the OCI layout with host `tar` and import it via `msb image load`. */
export async function archiveAndLoad(input: ArchiveInput): Promise<ArchiveResult> {
  const tarArgv = [input.tar, "-C", input.layoutDir, "-cf", input.archivePath, "."];
  const tarResult = await run(tarArgv, { printOnly: input.printOnly, label: "tar" });
  if (tarResult.exitCode !== 0) {
    return { exitCode: tarResult.exitCode, failedStage: "tar" };
  }
  const loadArgv = [input.msb, "image", "load", "--input", input.archivePath, "--tag", input.tag];
  const loadResult = await run(loadArgv, { printOnly: input.printOnly, label: "msb image load" });
  if (loadResult.exitCode !== 0) {
    return { exitCode: loadResult.exitCode, failedStage: "msb image load" };
  }
  return { exitCode: 0 };
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

// ---------------------------------------------------------------------------
// macOS builder plan
// ---------------------------------------------------------------------------

/**
 * Plan argv groups for a macOS builder invocation. The builder runs in
 * detached mode (`msb run --detach`), the command via `msb exec`, then
 * cleanup via `msb remove -f`. This avoids the attached-mode hang where
 * `msb run` does not return after the VM command exits.
 */
export interface MacOsBuilderPlan {
  /** `msb run --detach` — creates and starts the sandbox. */
  runArgv: string[];
  /** `msb exec` — runs the command inside the sandbox. */
  execArgv: string[];
  /** `msb remove -f` — stops and removes the sandbox. */
  removeArgv: string[];
  /** Sandbox name used across all three commands. */
  sandboxName: string;
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
  /** Effective base reference (defaults to config.build.from). */
  from?: string;
  /** Custom-base state — when present, generate the in-VM handoff script. */
  customBase?: CustomBaseState | null;
}): MacOsBuilderPlan {
  const msb = input.msbBinary ?? "msb";
  const guestProjectPath = "/workspace";
  const guestOutputPath = "/out";
  const from = input.from ?? input.config.build.from;
  const customBase = input.customBase ?? null;
  const sandboxName = `mise-msb-build-${Date.now()}`;

  // When a custom base is present, the mise oci build runs inside a shell
  // script that first starts a loopback registry and imports the base tar
  // via skopeo. Otherwise mise runs directly.
  let commandArgv: string[];
  if (customBase !== null) {
    const baseTarGuestPath = `${guestOutputPath}/base.tar`;
    const miseArgs = buildMiseOciArgv({
      mise: "mise",
      from: customBase.baseRef,
      tag: input.config.build.tag,
      output: `${guestOutputPath}/layout`,
      cwd: guestProjectPath,
    });
    const script = buildVmHandoffScript(baseTarGuestPath, customBase.registryTag, miseArgs, guestProjectPath);
    // Write the script to the output dir and mount it into the VM.
    const scriptPath = join(input.outputDir, "handoff.sh");
    try {
      writeFileSync(scriptPath, script, { mode: 0o755 });
    } catch {
      // In print mode the dir may not exist; the script content is what matters.
    }
    commandArgv = ["bash", `${guestOutputPath}/handoff.sh`];
  } else {
    commandArgv = buildMiseOciArgv({
      mise: "mise",
      from,
      tag: input.config.build.tag,
      output: `${guestOutputPath}/layout`,
      cwd: guestProjectPath,
    });
  }

  const mountArgs = [
    "--mount-dir",
    `${input.projectRoot}:${guestProjectPath}:ro`,
    "--mount-dir",
    `${input.outputDir}:${guestOutputPath}:rw`,
  ];
  const envArgs = ["--env", "MISE_EXPERIMENTAL=1"];
  const builderImage = input.config.build.builderImage || DEFAULT_BUILDER_IMAGE;

  const runArgv: string[] = [
    msb,
    "run",
    "--detach",
    builderImage,
    "--name",
    sandboxName,
    "--cpus",
    String(input.config.runtime.cpus),
    "--memory",
    input.config.runtime.memory,
    "--workdir",
    guestProjectPath,
    ...mountArgs,
    ...envArgs,
  ];

  const execArgv: string[] = [
    msb,
    "exec",
    sandboxName,
    "--",
    ...commandArgv,
  ];

  const removeArgv: string[] = [
    msb,
    "remove",
    "-f",
    sandboxName,
  ];

  return {
    runArgv,
    execArgv,
    removeArgv,
    sandboxName,
    guestProjectPath,
    guestOutputPath,
    hostOutputPath: input.outputDir,
  };
}

/**
 * Execute the macOS builder plan: detach-run, exec the command, then
 * remove the sandbox. Streams output to the terminal in non-print mode.
 */
export async function runMacOsBuilder(
  plan: MacOsBuilderPlan,
  printOnly: boolean,
): Promise<number> {
  // 1. Create and start the sandbox in detached mode.
  const runResult = await run(plan.runArgv, {
    printOnly,
    label: "msb run (detach)",
  });
  if (runResult.exitCode !== 0) {
    return runResult.exitCode;
  }

  // 2. Run the command inside the sandbox.
  const execResult = await run(plan.execArgv, {
    printOnly,
    label: "macOS Linux builder",
  });

  // 3. Always remove the sandbox, preserving the exec exit code.
  const removeResult = await run(plan.removeArgv, {
    printOnly,
    label: "msb remove",
  });
  if (execResult.exitCode !== 0) {
    return execResult.exitCode;
  }
  return removeResult.exitCode;
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
