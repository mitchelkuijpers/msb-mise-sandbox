/**
 * Print-mode plan for the build pipeline.
 *
 * Renders every stage that would execute — including the custom-base
 * preflight, host-side Docker build + save, the in-VM handoff (registry +
 * skopeo + mise oci build), archive, and load — as copyable argv groups
 * using stable placeholders for runtime-allocated values (`<build-id>`,
 * `<temp-output>`). No subprocess is spawned; this is a pure planner.
 */

import type { SandboxConfig } from "../config/types.js";
import { planMacOsBuilder, shouldUseDirectMise } from "./oci.js";
import { buildVmHandoffScript } from "./custombase.js";
import type { PersonalImage } from "./custombase.js";

export interface PrintPlanInput {
  config: SandboxConfig;
  projectRoot: string;
  platform: NodeJS.Platform;
  /** Discovered/supplied personal image (null when absent). */
  custom: PersonalImage | null;
}

const TEMP_OUTPUT = "<temp-output>";
const BUILD_ID = "<build-id>";
const BASE_REPO = "mise-msb/base";
const REGISTRY_TAG = `localhost:5000/${BASE_REPO}:${BUILD_ID}`;

/**
 * Plan the argv groups for `mise-msb build --print` in execution order.
 * Returns an array of argv arrays; the caller formats them as shell lines.
 */
export function planBuildGroups(input: PrintPlanInput): string[][] {
  const { config, projectRoot, platform, custom } = input;
  const tag = config.build.tag;

  if (custom === null) {
    return planNoCustomBase(config, projectRoot, platform, tag);
  }
  return planCustomBase(config, projectRoot, platform, tag, custom);
}

function planNoCustomBase(
  config: SandboxConfig,
  projectRoot: string,
  platform: NodeJS.Platform,
  tag: string,
): string[][] {
  if (shouldUseDirectMise(platform)) {
    const miseArgv = [
      "mise",
      "oci",
      "build",
      "--from",
      config.build.from,
      "--tag",
      tag,
      "--output",
      `${TEMP_OUTPUT}/layout`,
    ];
    return [
      miseArgv,
      tarGroup(),
      loadGroup(tag),
    ];
  }
  const plan = planMacOsBuilder({
    config,
    projectRoot,
    outputDir: TEMP_OUTPUT,
  });
  return [plan.runArgv, plan.execArgv, plan.removeArgv, tarGroup(), loadGroup(tag)];
}

function planCustomBase(
  config: SandboxConfig,
  projectRoot: string,
  platform: NodeJS.Platform,
  tag: string,
  custom: PersonalImage,
): string[][] {
  const groups: string[][] = [];

  // 1. Preflight: validate the Linux mise that will run mise oci build.
  groups.push(preflightGroup(config, platform));

  // 2. Build the personal Containerfile on the host with Docker.
  groups.push([
    "docker",
    "build",
    "--load",
    "-f",
    custom.containerfile,
    "-t",
    `mise-msb-base:${BUILD_ID}`,
    custom.contextDir,
  ]);

  // 3. Save the base image to a tar for transfer into the VM.
  groups.push([
    "docker",
    "save",
    "-o",
    `${TEMP_OUTPUT}/base.tar`,
    `mise-msb-base:${BUILD_ID}`,
  ]);

  // 4. Run the in-VM handoff (registry + skopeo + mise oci build).
  if (shouldUseDirectMise(platform)) {
    // On Linux the handoff runs directly on the host.
    groups.push([
      "bash",
      `${TEMP_OUTPUT}/handoff.sh`,
    ]);
  } else {
    const miseArgs = [
      "mise",
      "oci",
      "build",
      "--from",
      REGISTRY_TAG,
      "--tag",
      tag,
      "--output",
      "/out/layout",
    ];
    const script = buildVmHandoffScript("/out/base.tar", REGISTRY_TAG, miseArgs, "/workspace");
    // Show the script content as a comment, then the msb run command.
    const plan = planMacOsBuilder({
      config,
      projectRoot,
      outputDir: TEMP_OUTPUT,
      from: REGISTRY_TAG,
      customBase: {
        buildId: BUILD_ID,
        dockerTag: `mise-msb-base:${BUILD_ID}`,
        baseTarPath: `${TEMP_OUTPUT}/base.tar`,
        registryTag: REGISTRY_TAG,
        baseRef: REGISTRY_TAG,
        built: true,
      },
    });
    groups.push(plan.runArgv, plan.execArgv, plan.removeArgv);
    void script;
  }

  // 5. Archive the layout.
  groups.push(tarGroup());

  // 6. Load into the msb image cache.
  groups.push(loadGroup(tag));

  return groups;
}

function preflightGroup(config: SandboxConfig, platform: NodeJS.Platform): string[] {
  if (shouldUseDirectMise(platform)) {
    return ["mise", "--version"];
  }
  return ["msb", "run", config.build.builderImage, "--", "mise", "--version"];
}

function tarGroup(): string[] {
  return ["tar", "-C", `${TEMP_OUTPUT}/layout`, "-cf", `${TEMP_OUTPUT}/image.tar`, "."];
}

function loadGroup(tag: string): string[] {
  return ["msb", "image", "load", "--input", `${TEMP_OUTPUT}/image.tar`, "--tag", tag];
}
