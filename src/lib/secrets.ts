/**
 * Secret resolution and NetworkBuilder registration.
 *
 * v0.6.6 workaround: secrets are registered on the `NetworkBuilder` (not
 * `SandboxBuilder.secret()`). The env-var bridge sets guest environment
 * variables to placeholder strings (`$MSB_<NAME>`) while the real secret
 * value is registered on the network builder for secure substitution.
 */

import type { SecretEntry, SecretViolationPolicy } from "../types.js";

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a secret value from a `from` source string.
 *
 * Currently supports only `env:VARIABLE_NAME` format.
 * Throws if the environment variable is unset or empty.
 */
export function resolveSecretValue(from: string): string {
  const match = from.match(/^env:(.+)$/);
  if (!match) {
    throw new Error(
      `Invalid secret source "${from}": must be "env:VARIABLE_NAME"`,
    );
  }
  const envVar = match[1];
  const value = process.env[envVar];
  if (!value) {
    throw new Error(
      `Environment variable "${envVar}" is not set or empty (referenced by secret source "${from}")`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Map our `SecretViolationPolicy` to the native builder method name.
 */
function violationAction(vb: any, policy: SecretViolationPolicy): any {
  switch (policy) {
    case "block":
      return vb.block();
    case "block-and-log":
      return vb.blockAndLog();
    case "block-and-terminate":
      return vb.blockAndTerminate();
    default:
      return vb.block();
  }
}

/**
 * Register secrets on a `NetworkBuilder` and configure TLS + violation
 * actions.
 *
 * For each secret:
 *   1. Resolves the actual value from the host environment.
 *   2. Computes a placeholder (`$MSB_<env>`).
 *   3. Registers it on the network builder with allowed hosts/patterns.
 *
 * The caller is responsible for setting the placeholder as the guest env
 * var value on the `SandboxBuilder` (see return value).
 *
 * @returns A map of env-var-name → placeholder string.
 */
export function applySecrets(
  nb: any,
  secrets: SecretEntry[],
  violationPolicy: SecretViolationPolicy,
): Map<string, string> {
  if (secrets.length === 0) return new Map();

  // Enable TLS interception when secrets are present.
  nb.tls((t: any) => t);

  // Configure violation action.
  nb.onSecretViolation((vb: any) => violationAction(vb, violationPolicy));

  const placeholders = new Map<string, string>();

  for (const secret of secrets) {
    const value = resolveSecretValue(secret.from);
    const placeholder = `$MSB_${secret.env}`;
    const hosts = Array.isArray(secret.allow) ? secret.allow : [secret.allow];

    nb.secret((sb: any) => {
      sb = sb.env(secret.env).value(value).placeholder(placeholder);
      for (const host of hosts) {
        if (host.startsWith("*.")) {
          sb = sb.allowHostPattern(host);
        } else {
          sb = sb.allowHost(host);
        }
      }
      return sb;
    });

    placeholders.set(secret.env, placeholder);
  }

  return placeholders;
}
