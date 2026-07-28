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
}

/** Build the canonical `msb create <image> --name <name> ...` argv. */
export function buildCreateArgv(options: CreateOptions): string[] {
  const { config, name, image, replace, workdir } = options;
  const argv: string[] = ["msb", "create", image, "--name", name];

  argv.push("--cpus", String(config.runtime.cpus));
  argv.push("--memory", config.runtime.memory);

  const effectiveWorkdir = workdir ?? config.workdirTarget;
  if (effectiveWorkdir.length > 0) {
    argv.push("--workdir", effectiveWorkdir);
  }

  if (replace === true) {
    argv.push("--replace");
  }

  // Environment entries (sorted by key for determinism).
  for (const key of Object.keys(config.env).sort()) {
    argv.push("--env", `${key}=${config.env[key]}`);
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

  // Mounts (sorted by name).
  for (const name of Object.keys(config.mounts).sort()) {
    const mount = config.mounts[name];
    if (mount === undefined) continue;
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
