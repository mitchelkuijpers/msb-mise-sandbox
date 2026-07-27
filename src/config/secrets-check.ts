/**
 * Secret-source presence checks.
 *
 * The wrapper never reads, copies, logs, or places secret values in argv.
 * It only verifies that each referenced host environment variable is set
 * before generating the `msb --secret SOURCE@HOST` argument.
 */

import type { SandboxConfig } from "./types.js";

export class MissingSecretError extends Error {
  readonly envName: string;
  constructor(envName: string) {
    super(`required secret source environment variable not set: ${envName}`);
    this.name = "MissingSecretError";
    this.envName = envName;
  }
}

/**
 * Verify that every configured secret source is set in the host env.
 * Does not read the values — only checks presence.
 */
export function assertSecretSourcesPresent(
  config: SandboxConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const [name, secret] of Object.entries(config.secrets)) {
    if (secret.from.length === 0) {
      throw new MissingSecretError(`<empty source for secret "${name}">`);
    }
    if (env[secret.from] === undefined) {
      throw new MissingSecretError(secret.from);
    }
  }
}

/**
 * Redact any secret-like values from a free-form string.
 * Used by the `config` command and any error reporter to ensure secret
 * values can never leak through wrapper output.
 */
export function redactSecretValues(
  text: string,
  config: SandboxConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  let result = text;
  for (const secret of Object.values(config.secrets)) {
    const value = env[secret.from];
    if (value !== undefined && value.length > 0) {
      result = result.split(value).join(`<${secret.from}>`);
    }
  }
  return result;
}
