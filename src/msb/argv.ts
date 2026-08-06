/**
 * Deterministic `msb` argv generation.
 *
 * Every msb command produced by the wrapper goes through one of the
 * builders in this file. Output is deterministic — same merged config
 * yields byte-identical argv — and sorted by entry name where the source
 * data is a record.
 */

import type {
  MountEntry,
  PortEntry,
  SandboxConfig,
  SecretEntry,
} from "../config/types.js";
import {
  STOCK_MISE_MOUNT_TARGET,
  STOCK_DOCKER_MOUNT_TARGET,
} from "../stock-image/constants.js";
import {
  GIT_CONFIG_GLOBAL_ENV,
  GUEST_GITCONFIG_PATH,
  GUEST_HOST_GITCONFIG_PATH,
  GUEST_KEY_PATH,
  GUEST_PUBKEY_PATH,
} from "../signing/paths.js";
import { writeGuestGitconfig, type GitIdentity } from "../signing/gitconfig.js";
import { type ValidatedSigningKey } from "../signing/validate.js";
import { expandHome } from "../config/merge.js";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Prefix microsandbox uses for source-based secret placeholders. The
 * full placeholder is `$MSB_<SOURCE_ENV>` and is substituted only at
 * the allowed TLS boundary; the wrapper never resolves the value.
 */
export const MSB_PLACEHOLDER_PREFIX = "$MSB_";

// ---------------------------------------------------------------------------
// `msb create` argv
// ---------------------------------------------------------------------------

export interface CreateOptions {
  /** Image positional argument. */
  image: string;
  /** Sandbox name (used as --name). */
  name: string;
  /** Merged sandbox config. */
  config: SandboxConfig;
  /** When true, replace an existing sandbox with the same name. */
  replace?: boolean;
  /** Optional workdir override (defaults to config.workdirTarget). */
  workdir?: string;
  /** Optional home dir override (used in tests; for host gitconfig detection). */
  homeDir?: string;
  /**
   * Validated signing key pair when signing is enabled, undefined otherwise.
   * Used for emitting canonical mount paths.
   */
  signingKey?: ValidatedSigningKey;
  /**
   * Committer identity pinned into the generated guest gitconfig when
   * signing is enabled (resolved by the caller via hostGitIdentity()).
   */
  gitIdentity?: GitIdentity;
}

/** Build the canonical `msb create <image> --name <name> ...` argv. */
export function buildCreateArgv(options: CreateOptions): string[] {
  const { config, name, image, replace, workdir, signingKey } = options;
  const argv: string[] = ["msb", "create", image, "--name", name];

  argv.push("--cpus", String(config.runtime.cpus));
  argv.push("--memory", config.runtime.memory);
  argv.push("--root-disk", config.runtime.rootDisk);

  const effectiveWorkdir = workdir ?? config.workdirTarget;
  if (effectiveWorkdir.length > 0) {
    argv.push("--workdir", effectiveWorkdir);
  }

  if (replace === true) {
    argv.push("--replace");
  }

  // Compute secret bridge keys: secrets whose guest name differs from
  // their source. These produce a literal `$MSB_<SOURCE_ENV>` placeholder
  // and are authoritative over any conflicting ordinary env entry.
  const bridgeKeys = new Set<string>();
  for (const [secretName, entry] of Object.entries(config.secrets)) {
    if (entry === undefined) continue;
    if (entry.from.length > 0 && secretName !== entry.from) {
      bridgeKeys.add(secretName);
    }
  }

  // Environment entries (sorted by key for determinism). Secret guest
  // names that have a bridge win authoritatively over any conflicting
  // ordinary env entry.
  for (const key of Object.keys(config.env).sort()) {
    if (bridgeKeys.has(key)) continue;
    argv.push("--env", `${key}=${config.env[key]}`);
  }

  // Bridge entries for secrets with differing guest/source names.
  for (const key of [...bridgeKeys].sort()) {
    const entry = config.secrets[key];
    if (entry === undefined) continue;
    argv.push("--env", `${key}=${MSB_PLACEHOLDER_PREFIX}${entry.from}`);
  }

  // Labels (sorted by key).
  for (const key of Object.keys(config.labels).sort()) {
    const value = config.labels[key];
    argv.push("--label", value.length > 0 ? `${key}=${value}` : key);
  }

  // Network: default + sorted rules.
  argv.push("--net-default", config.network.defaultEgress);
  for (const rule of [...config.network.allow].sort()) {
    argv.push("--net-rule", `allow@${rule}`);
  }

  // Secrets: each entry produces one --secret per host (sorted).
  for (const secretName of Object.keys(config.secrets).sort()) {
    const entry = config.secrets[secretName];
    if (entry === undefined) continue;
    argv.push(...secretArgv(entry));
  }

  // Mounts (sorted by name). When signing is enabled, a mounted host
  // ~/.gitconfig is retargeted to the neutral include path so the
  // generated gitconfig owns the guest's global slot (design D2).
  const signingEnabled = config.signing.enabled &&
    config.signing.key !== undefined && config.signing.key.length > 0;
  const homeDir = options.homeDir ?? homedir();
  let hostGitconfigMounted = false;
  for (const name of Object.keys(config.mounts).sort()) {
    const mount = config.mounts[name];
    if (mount === undefined) continue;
    if (signingEnabled && isHostGitconfigMount(mount, homeDir)) {
      hostGitconfigMounted = true;
      argv.push("--mount-file", `${mount.source}:${GUEST_HOST_GITCONFIG_PATH}:ro`);
      continue;
    }
    argv.push(...mountArgv(mount));
  }

  // Stock mode: inject derived persistent mounts for mise and Docker data.
  if (config.stock.imageMode === "stock") {
    const miseVolName = `${name}-mise-v1`;
    const dockerVolName = `${name}-docker-data`;
    argv.push("--mount-named", `${miseVolName}:${STOCK_MISE_MOUNT_TARGET}`);
    argv.push(
      "--mount-named",
      `${dockerVolName}:${STOCK_DOCKER_MOUNT_TARGET}:kind=disk,size=${config.stock.dockerDataSize}`,
    );
  }

  // Signing: read-only key mounts, generated gitconfig via --copy, and
  // GIT_CONFIG_GLOBAL. Key material is referenced by path only.
  if (signingEnabled) {
    if (signingKey) {
      argv.push("--mount-file", `${signingKey.privateKeyPath}:${GUEST_KEY_PATH}:ro`);
      argv.push(
        "--mount-file",
        `${signingKey.publicKeyPath}:${GUEST_PUBKEY_PATH}:ro`,
      );
    } else {
      // Direct argv tests do not run command-level signing validation.
      const keyPath = config.signing.key;
      if (keyPath !== undefined) {
        argv.push("--mount-file", `${keyPath}:${GUEST_KEY_PATH}:ro`);
        argv.push("--mount-file", `${keyPath}.pub:${GUEST_PUBKEY_PATH}:ro`);
      }
    }
    const gitconfigTmp = writeGuestGitconfig(name, hostGitconfigMounted, options.gitIdentity ?? {});
    argv.push("--copy", `${gitconfigTmp}:${GUEST_GITCONFIG_PATH}`);
    argv.push("--env", `${GIT_CONFIG_GLOBAL_ENV}=${GUEST_GITCONFIG_PATH}`);
  }

  // Ports (sorted by name).
  for (const name of Object.keys(config.ports).sort()) {
    const port = config.ports[name];
    if (port === undefined) continue;
    argv.push("--port", portToString(port));
  }

  return argv;
}

// ---------------------------------------------------------------------------
// `msb create` argv helpers
// ---------------------------------------------------------------------------

/** True when a file mount sources the host's ~/.gitconfig. */
export function isHostGitconfigMount(mount: MountEntry, homeDir: string = homedir()): boolean {
  if (mount.kind !== "file") return false;
  return expandHome(mount.source, homeDir) === join(homeDir, ".gitconfig");
}

/** Translate a MountEntry to one of the canonical `--mount-*` argv pairs. */
export function mountArgv(mount: MountEntry): string[] {
  const target = mount.options !== undefined && mount.options.length > 0
    ? `${mount.target}:${mount.options}`
    : mount.target;
  switch (mount.kind) {
    case "dir":
      return ["--mount-dir", `${mount.source}:${target}`];
    case "file":
      return ["--mount-file", `${mount.source}:${target}`];
    case "disk": {
      const size = mount.size ?? "10G";
      return ["--mount-named", `${mount.source}:${target}:kind=disk,size=${size}`];
    }
    case "named":
      return ["--mount-named", `${mount.source}:${target}`];
  }
}

/** Translate a PortEntry into the supported `BIND:HOST:GUEST[/udp]` form. */
export function portToString(port: PortEntry): string {
  const protocolSuffix = port.protocol === "udp" ? "/udp" : "";
  return `${port.bind}:${port.hostPort}:${port.guestPort}${protocolSuffix}`;
}

/** Emit one `--secret SOURCE@HOST` argument per allowed host. */
export function secretArgv(entry: SecretEntry): string[] {
  const argv: string[] = [];
  for (const host of [...entry.hosts].sort()) {
    argv.push("--secret", `${entry.from}@${host}`);
  }
  return argv;
}

// ---------------------------------------------------------------------------
// Lifecycle delegation
// ---------------------------------------------------------------------------

/** `msb start <name>` */
export function buildStartArgv(name: string): string[] {
  return ["msb", "start", name];
}

/** `msb stop <name>` */
export function buildStopArgv(name: string): string[] {
  return ["msb", "stop", name];
}

/** `msb remove <name>` */
export function buildRemoveArgv(name: string): string[] {
  return ["msb", "remove", name];
}

/** `msb list` */
export function buildListArgv(): string[] {
  return ["msb", "list"];
}

/**
 * `msb exec <name> -- <command...>`
 * The trailing `--` separator preserves arguments as-is; callers must
 * supply the command argv including argv[0] (e.g. `["bun", "test"]`).
 */
export function buildExecArgv(name: string, command: string[]): string[] {
  return ["msb", "exec", name, "--", ...command];
}

/**
 * `msb run <image> --name <name> -- <command...>`
 * Convenience form used when the wrapper wants to create + start + exec in
 * a single msb invocation (currently used only by build pipelines).
 */
export function buildRunArgv(
  image: string,
  name: string,
  cpus: number,
  memory: string,
  command: string[],
  mounts: Array<{ argv: string[] }> = [],
): string[] {
  const argv = [
    "msb",
    "run",
    image,
    "--name",
    name,
    "--cpus",
    String(cpus),
    "--memory",
    memory,
    "--detach",
  ];
  for (const m of mounts) {
    argv.push(...m.argv);
  }
  argv.push("--", ...command);
  return argv;
}
