/**
 * `config` — Print the effective merged configuration.
 *
 * Output excludes secret values: only the env-var source names and
 * allowed host lists are shown.
 */

import type { GlobalOptions } from "./dispatch.js";
import { resolveInvocation } from "./_shared.js";
import { redactSecretValues } from "../config/secrets-check.js";

export async function runConfigCommand(
  _global: GlobalOptions,
  _args: string[],
): Promise<void> {
  const { config, projectRoot } = await resolveInvocation(_global, _args);
  // Stable JSON output: sorted keys, no whitespace noise.
  const printable = {
    projectRoot,
    identity: config.identity,
    build: config.build,
    runtime: config.runtime,
    workdirTarget: config.workdirTarget,
    mounts: config.mounts,
    ports: config.ports,
    network: config.network,
    env: config.env,
    secrets: config.secrets,
    labels: config.labels,
    ...(config.command !== undefined ? { command: config.command } : {}),
  };
  const json = JSON.stringify(printable, sortReplacer, 2);
  // Belt-and-braces: never leak a secret value through the printed
  // config, even if the merge layer was given one by mistake.
  process.stdout.write(redactSecretValues(json, config) + "\n");
}

function sortReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = obj[k];
        return acc;
      }, {});
  }
  return value;
}
