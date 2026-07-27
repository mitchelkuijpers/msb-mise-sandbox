/**
 * Shared command helpers — load config and resolve CLI overrides.
 */

import { loadConfig } from "../config/index.js";
import { assertSecretSourcesPresent } from "../config/secrets-check.js";
import type { SandboxConfig } from "../config/types.js";
import { deriveDefaultTag, deriveProjectName } from "../config/naming.js";
import { dirname } from "node:path";
import { findProjectConfig } from "../config/loader.js";
import type { GlobalOptions } from "./dispatch.js";

export interface ResolvedInvocation {
  config: SandboxConfig;
  projectRoot: string;
  /** Effective print-only flag (global || command-specific). */
  print: boolean;
}

/** Load config + apply CLI overrides common to most lifecycle commands. */
export async function resolveInvocation(
  global: GlobalOptions,
  commandArgs: string[],
  flags: { printFlag?: boolean } = {},
): Promise<ResolvedInvocation> {
  const { config, projectRoot } = await loadConfig({
    configPath: global.configPath,
  });
  const print = global.print || (flags.printFlag ?? false);
  void assertSecretSourcesPresent(config);
  void commandArgs;
  return { config, projectRoot, print };
}

/**
 * Apply a CLI name override to the merged config. When the user passes
 * an explicit <name> positional, we re-derive the image tag from that
 * name so the default `<name>:dev` stays consistent.
 */
export function applyNameOverride(
  config: SandboxConfig,
  explicitName: string | undefined,
  projectRoot: string,
): SandboxConfig {
  if (explicitName === undefined) return config;
  config.identity.name = explicitName;
  if (config.build.tag === "" || config.build.tag.endsWith(":dev") && config.build.tag.startsWith(deriveProjectName(projectRoot))) {
    config.build.tag = deriveDefaultTag(explicitName);
  }
  return config;
}

export function detectProjectRoot(start: string = process.cwd()): string {
  const found = findProjectConfig(start);
  return found !== null ? dirname(found) : start;
}
