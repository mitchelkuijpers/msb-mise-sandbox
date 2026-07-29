/**
 * Fail-closed signing key validation.
 *
 * When `[signing]` is enabled, the configured key is checked before any
 * `msb` invocation. Key material is inspected only via `ssh-keygen`
 * subprocesses — the wrapper never reads, persists, prints, or places
 * private key content in argv or environment output.
 */

import { realpathSync, readFileSync, statSync } from "node:fs";
import { sep } from "node:path";
import type { SandboxConfig } from "../config/types.js";
import { signingDir } from "./paths.js";

/**
 * Validation options for ssh-keygen subprocess behavior.
 * Allows testing against non-default executables.
 */
export interface ValidationOptions {
  /** Custom ssh-keygen executable path. Defaults to "ssh-keygen". */
  sshKeygenPath?: string;
}

export class SigningValidationError extends Error {
  constructor(
    message: string,
    /** Name of the failed check. */
    readonly check: string,
  ) {
    super(message);
    this.name = "SigningValidationError";
  }
}

/**
 * Canonical path pair returned by successful signing validation.
 */
export interface ValidatedSigningKey {
  /** Fully resolved private key path (post symlink resolution). */
  readonly privateKeyPath: string;
  /** Fully resolved public key path (siblings of private key). */
  readonly publicKeyPath: string;
}

/**
 * Validate the configured signing key and return the canonical path pair.
 * No-op when signing is disabled (returns undefined).
 * Throws SigningValidationError on the first failed check.
 */
export function validateSigningKey(
  config: SandboxConfig,
  homeDir?: string,
  options: ValidationOptions = {},
): ValidatedSigningKey | undefined {
  const sshKeygenPath = options.sshKeygenPath ?? "ssh-keygen";

  if (!config.signing.enabled) return undefined;

  const key = config.signing.key;
  if (key === undefined || key.length === 0) {
    throw new SigningValidationError(
      "signing is enabled but signing.key is not set; run `mise-msb signing init` " +
        "and set signing.key to the generated key path",
      "location",
    );
  }

  // Location invariant: the key must resolve (after symlink resolution)
  // to a path under the wrapper-owned signing directory.
  const dir = signingDir(homeDir);
  let resolvedDir: string;
  let resolvedKey: string;
  try {
    resolvedDir = realpathSync(dir);
  } catch {
    throw new SigningValidationError(
      `signing directory ${dir} does not exist; run \`mise-msb signing init\` to create it`,
      "location",
    );
  }
  try {
    resolvedKey = realpathSync(key);
  } catch {
    throw new SigningValidationError(
      `signing key ${key} does not exist; run \`mise-msb signing init\` to generate one`,
      "location",
    );
  }
  // Reject in-directory symlinks that point outside the signing directory.
  const dirStem = resolvedDir + sep;
  if (resolvedKey !== resolvedDir && !resolvedKey.startsWith(dirStem)) {
    throw new SigningValidationError(
      `signing key resolves to ${resolvedKey}, which is outside the wrapper-owned ` +
        `signing directory ${resolvedDir}; signing keys must live under that directory ` +
        `so the feature can never point at an authentication key (run \`mise-msb signing init\`)`,
      "location",
    );
  }

  // Permissions: must be a subset of 0600 (no execute bits).
  const mode = statSync(resolvedKey).mode;
  const perm = mode & 0o777;
  // Reject if any bits beyond owner read/write (0600) are set.
  if ((perm & ~0o600) !== 0) {
    throw new SigningValidationError(
      `signing key ${resolvedKey} has permissions ${perm.toString(8).padStart(3, "0")}, ` +
        `which is broader than 0600; run \`chmod 600 ${resolvedKey}\``,
      "permissions",
    );
  }

  // Type: must be ed25519.
  const listing = sshKeygen(sshKeygenPath, ["-l", "-f", resolvedKey]);
  if (listing.length === 0 || !listing.includes("ED25519")) {
    throw new SigningValidationError(
      `signing key ${resolvedKey} is not an ed25519 key; run \`mise-msb signing init\` to generate one`,
      "type",
    );
  }

  // Encryption: `ssh-keygen -y -P ""` derives the public key only when
  // the private key is passphrase-less. This is also the only point at
  // which key material is touched, and it stays inside the subprocess.
  const derived = sshKeygen(sshKeygenPath, ["-y", "-P", "", "-f", resolvedKey]);
  if (derived.length === 0) {
    throw new SigningValidationError(
      `signing key ${resolvedKey} is passphrase-protected; sandbox signing requires an ` +
        `unencrypted key — run \`mise-msb signing init --force\` to generate one`,
      "encryption",
    );
  }

  // Sibling .pub must exist and match the derived public key.
  const pubPath = `${resolvedKey}.pub`;
  let resolvedPubPath: string;
  let sibling: string;
  try {
    resolvedPubPath = realpathSync(pubPath);
    sibling = readFileSync(resolvedPubPath, "utf8");
  } catch {
    throw new SigningValidationError(
      `public key ${pubPath} is missing; run \`mise-msb signing init --force\` to regenerate the keypair`,
      "pubkey",
    );
  }
  if (publicKeyBody(sibling) !== publicKeyBody(derived)) {
    throw new SigningValidationError(
      `public key ${resolvedPubPath} does not match the private key ${resolvedKey}; ` +
        `run \`mise-msb signing init --force\` to regenerate the keypair`,
      "pubkey",
    );
  }

  return { privateKeyPath: resolvedKey, publicKeyPath: resolvedPubPath };
}

/**
 * Run ssh-keygen; return trimmed stdout on success, empty string on failure.
 */
function sshKeygen(executable: string, args: string[]): string {
  let proc: ReturnType<typeof Bun.spawnSync>;
  try {
    proc = Bun.spawnSync({
      cmd: [executable, ...args],
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // Subprocess launch exception: treat as ssh-keygen not found.
    throw new SigningValidationError(
      `ssh-keygen executable named "${executable}" could not be launched; ` +
        `please install it or ensure it is executable on PATH`,
      "ssh-keygen",
    );
  }
  if (proc.exitCode !== 0 || proc.stdout === undefined) return "";
  return proc.stdout.toString().trim();
}

/** Compare public keys by type + body, ignoring the comment field. */
function publicKeyBody(line: string): string {
  const parts = line.trim().split(/\s+/);
  return parts.slice(0, 2).join(" ");
}
