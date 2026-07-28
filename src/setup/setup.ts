import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { STOCK_IMAGE_TAG, CONTAINERFILE_PATH, STOCK_IMAGE_DIR } from "../stock-image/constants.js";
import { formatArgvGroups } from "../msb/print.js";
import { run, which } from "../msb/subprocess.js";

export interface SetupPlan {
  groups: string[][];
  imageTag: string;
}

export interface SetupInputs {
  printOnly: boolean;
  force: boolean;
  outputDir?: string;
  dockerBinary?: string;
  msbBinary?: string;
  platform?: NodeJS.Platform;
}

export interface SetupOutput {
  exitCode: number;
  failedStage?: string;
  archivePath?: string;
  skipped: boolean;
}

function createTempDir(prefix: string): string {
  const path = join(process.cwd(), ".mise-msb-setup", `${prefix}${Date.now()}`);
  mkdirSync(path, { recursive: true });
  return path;
}

function safeRm(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
  }
}

export function planSetup(input: SetupInputs): SetupPlan {
  const docker = input.dockerBinary ?? "docker";
  const msb = input.msbBinary ?? "msb";
  const outputDir = input.outputDir ?? "<temp-output>";

  const groups: string[][] = [];

  if (input.force) {
    groups.push([docker, "images", "-q", STOCK_IMAGE_TAG]);
  }

  groups.push([docker, "build", "-t", STOCK_IMAGE_TAG, "-f", CONTAINERFILE_PATH, STOCK_IMAGE_DIR]);

  const tarArchive = join(outputDir, "stock-image.tar");
  groups.push([docker, "save", STOCK_IMAGE_TAG, "-o", tarArchive]);

  groups.push([msb, "image", "load", "--input", tarArchive, "--tag", STOCK_IMAGE_TAG]);

  return { groups, imageTag: STOCK_IMAGE_TAG };
}

function preservedArchive(path: string): string | undefined {
  return existsSync(path) ? path : undefined;
}

export async function runSetup(input: SetupInputs): Promise<SetupOutput> {
  const docker = input.dockerBinary ?? which("docker") ?? "docker";
  const msb = input.msbBinary ?? which("msb") ?? "msb";

  if (docker === "docker") {
    const dockerCheck = which("docker");
    if (dockerCheck === null) {
      return { exitCode: 1, failedStage: "docker preflight", skipped: false };
    }
  }

  const platform = input.platform ?? process.platform;
  if (platform !== "linux" && platform !== "darwin") {
    return { exitCode: 1, failedStage: "unsupported platform", skipped: false };
  }

  if (!input.force) {
    const checkArgv = [msb, "image", "list"];
    const checkProc = Bun.spawnSync({ cmd: checkArgv, stdio: ["pipe", "pipe", "pipe"] });
    if (checkProc.exitCode === 0) {
      const stdout = checkProc.stdout.toString();
      if (stdout.includes(STOCK_IMAGE_TAG)) {
        return { exitCode: 0, skipped: true };
      }
    }
  }

  if (input.printOnly) {
    const plan = planSetup(input);
    process.stdout.write(formatArgvGroups(plan.groups) + "\n");
    return { exitCode: 0, skipped: false };
  }

  const outputDir = input.outputDir ?? createTempDir("mise-msb-setup-");
  const layoutDir = join(outputDir, "layout");
  const archivePath = join(outputDir, "stock-image.tar");

  try {
    mkdirSync(layoutDir, { recursive: true });

    const buildArgv = [docker, "build", "-t", STOCK_IMAGE_TAG, "-f", CONTAINERFILE_PATH, STOCK_IMAGE_DIR];
    const buildResult = await run(buildArgv, {
      printOnly: false,
      label: "docker build",
    });
    if (buildResult.exitCode !== 0) {
      return { exitCode: buildResult.exitCode, failedStage: "docker build", archivePath: preservedArchive(archivePath), skipped: false };
    }

    const saveArgv = [docker, "save", STOCK_IMAGE_TAG, "-o", archivePath];
    const saveResult = await run(saveArgv, {
      printOnly: false,
      label: "docker save",
    });
    if (saveResult.exitCode !== 0) {
      return { exitCode: saveResult.exitCode, failedStage: "docker save", archivePath: preservedArchive(archivePath), skipped: false };
    }

    const loadArgv = [msb, "image", "load", "--input", archivePath, "--tag", STOCK_IMAGE_TAG];
    const loadResult = await run(loadArgv, {
      printOnly: false,
      label: "msb image load",
    });
    if (loadResult.exitCode !== 0) {
      return { exitCode: loadResult.exitCode, failedStage: "msb image load", archivePath: preservedArchive(archivePath), skipped: false };
    }

    safeRm(outputDir);
    return { exitCode: 0, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, failedStage: `mise-msb setup: ${message}`, archivePath: preservedArchive(archivePath), skipped: false };
  }
}
