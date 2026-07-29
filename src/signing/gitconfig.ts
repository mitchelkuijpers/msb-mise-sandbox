/**
 * Guest gitconfig generation for sandbox commit signing.
 *
 * The generated file owns the guest's global git config slot (via
 * `GIT_CONFIG_GLOBAL`). It optionally `[include]`s the neutrally mounted
 * host gitconfig so host identity flows through, then pins the signing
 * entries after the include so they win under git's precedence rules.
 * The generated file contains no key material — paths only.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GUEST_HOST_GITCONFIG_PATH, GUEST_PUBKEY_PATH } from "./paths.js";

/** Committer identity pinned into the generated guest gitconfig. */
export interface GitIdentity {
  name?: string;
  email?: string;
}

/**
 * Resolve the operator's git identity from the host's global git config.
 * Read-only `git config` lookups; missing values are simply omitted.
 */
export function hostGitIdentity(): GitIdentity {
  const name = gitConfigGet("user.name");
  const email = gitConfigGet("user.email");
  const identity: GitIdentity = {};
  if (name !== null) identity.name = name;
  if (email !== null) identity.email = email;
  return identity;
}

function gitConfigGet(key: string): string | null {
  let proc: ReturnType<typeof Bun.spawnSync>;
  try {
    // No --global: `--global --get` consults only the XDG config file
    // when XDG_CONFIG_HOME is set and misses ~/.gitconfig entirely.
    proc = Bun.spawnSync({
      cmd: ["git", "config", "--get", key],
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  if (proc.exitCode !== 0 || proc.stdout === undefined) return null;
  const value = proc.stdout.toString().trim();
  return value.length > 0 ? value : null;
}

/**
 * Generate the guest gitconfig content. When `includeHostGitconfig` is
 * true the file begins with an include of the neutral host-gitconfig
 * mount target; the pinned identity and signing entries follow so they
 * override any inherited configuration. The generated file contains no
 * key material — paths and identity values only.
 */
export function generateGuestGitconfig(
  includeHostGitconfig: boolean,
  identity: GitIdentity = {},
): string {
  const lines: string[] = [];
  if (includeHostGitconfig) {
    lines.push("[include]", `    path = ${GUEST_HOST_GITCONFIG_PATH}`);
  }
  lines.push("[gpg]", "    format = ssh", "[user]");
  if (identity.name !== undefined) {
    lines.push(`    name = ${sanitizeIniValue(identity.name)}`);
  }
  if (identity.email !== undefined) {
    lines.push(`    email = ${sanitizeIniValue(identity.email)}`);
  }
  lines.push(
    `    signingkey = ${GUEST_PUBKEY_PATH}`,
    "[commit]",
    "    gpgsign = true",
  );
  return lines.join("\n") + "\n";
}

/** Collapse anything that could break out of a single gitconfig line. */
function sanitizeIniValue(value: string): string {
  return value.replace(/[\r\n]/g, " ").trim();
}

/** Deterministic host-side temp path for a sandbox's generated gitconfig. */
export function guestGitconfigTempPath(name: string): string {
  return join(tmpdir(), "mise-msb", `gitconfig-${name}`);
}

/** Write the generated gitconfig to its temp path; returns the path. */
export function writeGuestGitconfig(
  name: string,
  includeHostGitconfig: boolean,
  identity: GitIdentity = {},
): string {
  const path = guestGitconfigTempPath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generateGuestGitconfig(includeHostGitconfig, identity), { mode: 0o644 });
  return path;
}
