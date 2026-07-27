/**
 * `build` — Build OCI image from the project's mise.toml.
 */

import { buildOciImage, planMacOsBuilder, runMacOsBuilder, shouldUseDirectMise } from "../build/oci.js";
import type { GlobalOptions } from "./dispatch.js";
import { resolveInvocation } from "./_shared.js";

export async function runBuildCommand(
  global: GlobalOptions,
  args: string[],
): Promise<void> {
  const { config, projectRoot, print } = await resolveInvocation(global, args);
  void args;

  const platform = process.platform;
  if (!shouldUseDirectMise(platform) && platform !== "darwin") {
    throw new Error(
      `mise-msb build: unsupported host platform "${platform}" — Linux or macOS required`,
    );
  }

  if (print) {
    const { formatArgvGroups } = await import("../msb/print.js");
    if (shouldUseDirectMise(platform)) {
      const miseArgv = [
        "mise",
        "oci",
        "build",
        "--from",
        config.build.from,
        "--tag",
        config.build.tag,
        "--output",
        "<temp-output>/layout",
      ];
      const tarArgv = ["tar", "-C", "<temp-output>/layout", "-cf", "<temp-output>/image.tar", "."];
      const loadArgv = ["msb", "image", "load", "--input", "<temp-output>/image.tar", "--tag", config.build.tag];
      process.stdout.write(formatArgvGroups([miseArgv, tarArgv, loadArgv]) + "\n");
    } else {
      const plan = planMacOsBuilder({
        config,
        projectRoot,
        outputDir: "<temp-output>",
      });
      const tarArgv = ["tar", "-C", "<temp-output>/layout", "-cf", "<temp-output>/image.tar", "."];
      const loadArgv = ["msb", "image", "load", "--input", "<temp-output>/image.tar", "--tag", config.build.tag];
      process.stdout.write(formatArgvGroups([plan.argv, tarArgv, loadArgv]) + "\n");
    }
    return;
  }

  if (shouldUseDirectMise(platform)) {
    const result = await buildOciImage({ config, projectRoot, printOnly: false });
    if (result.exitCode !== 0) {
      console.error(
        `mise-msb build: stage "${result.failedStage}" failed; archive preserved at ${result.archivePath}`,
      );
      process.exit(result.exitCode);
    }
    console.log(`mise-msb build: loaded ${config.build.tag}`);
    return;
  }

  const { mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const outputDir = join(process.cwd(), ".mise-msb-build", `macos-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });
  const plan = planMacOsBuilder({ config, projectRoot, outputDir });
  const exit = await runMacOsBuilder(plan, false);
  if (exit !== 0) {
    console.error(`mise-msb build: macOS builder failed with exit ${exit}`);
    process.exit(exit);
  }
  const result = await buildOciImage({
    config,
    projectRoot,
    printOnly: false,
    outputDir,
  });
  if (result.exitCode !== 0) {
    console.error(
      `mise-msb build: archive/load failed; artifacts preserved at ${result.archivePath}`,
    );
    process.exit(result.exitCode);
  }
  console.log(`mise-msb build: loaded ${config.build.tag}`);
}
