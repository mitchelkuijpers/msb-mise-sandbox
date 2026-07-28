/**
 * `build` — Build OCI image from the project's mise.toml.
 *
 * When a personal Containerfile is present at
 * `~/.config/mise-msb/image/Containerfile`, the build uses a locally built
 * base handed to `mise oci build` through a temporary loopback registry.
 * Otherwise it uses the configured `build.from` directly without Docker.
 */

import { runBuildPipeline, shouldUseDirectMise } from "../build/oci.js";
import { planBuildGroups } from "../build/print.js";
import { discoverPersonalContainerfile } from "../build/custombase.js";
import { formatArgvGroups } from "../msb/print.js";
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
    const custom = discoverPersonalContainerfile();
    const groups = planBuildGroups({ config, projectRoot, platform, custom });
    process.stdout.write(formatArgvGroups(groups) + "\n");
    return;
  }

  const result = await runBuildPipeline({
    config,
    projectRoot,
    printOnly: false,
    discoverContainerfile: true,
  });
  if (result.exitCode !== 0) {
    const detail = result.message !== undefined ? `\n${result.message}` : "";
    console.error(
      `mise-msb build: stage "${result.failedStage}" failed; archive preserved at ${result.archivePath}${detail}`,
    );
    process.exit(result.exitCode);
  }
  console.log(`mise-msb build: loaded ${config.build.tag}`);
}
