/**
 * Shared command helpers — load config and resolve CLI overrides.
 */

import { loadConfig } from "../config/index.js";
import { assertSecretSourcesPresent } from "../config/secrets-check.js";
import type { SandboxConfig } from "../config/types.js";
import { deriveProjectName } from "../config/naming.js";
import { dirname } from "node:path";
import { findProjectConfig } from "../config/loader.js";
import { configurePersonalBootstrap } from "../bootstrap/discovery.js";
import {
  SigningValidationError,
  ValidatedSigningKey,
  validateSigningKey,
} from "../signing/validate.js";
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
  configurePersonalBootstrap(config);
  const print = global.print || (flags.printFlag ?? false);
  void assertSecretSourcesPresent(config);
  void commandArgs;
  return { config, projectRoot, print };
}

/**
 * Fail-closed signing gate for commands that may create the sandbox.
 * Runs full key validation (including ssh-keygen subprocesses) in both
 * normal and print modes, before any `msb` invocation.
 * Returns the validated key pair when signing is enabled.
 */
export function gateSigningValidation(config: SandboxConfig): ValidatedSigningKey | undefined {
  try {
    return validateSigningKey(config);
  } catch (err) {
    if (err instanceof SigningValidationError) {
      console.error(`mise-msb: signing validation failed (${err.check} check)`);
      console.error(`  ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

/**
 * Apply a CLI name override to the merged config. The sandbox name
 * is set to the explicit name. Image reference is not derived from
 * the name — stock mode uses the versioned stock tag; custom mode
 * requires an explicit reference.
 */
export function applyNameOverride(
  config: SandboxConfig,
  explicitName: string | undefined,
  _projectRoot: string,
): SandboxConfig {
  if (explicitName === undefined) return config;
  config.identity.name = explicitName;
  return config;
}

export function detectProjectRoot(start: string = process.cwd()): string {
  const found = findProjectConfig(start);
  return found !== null ? dirname(found) : start;
}
