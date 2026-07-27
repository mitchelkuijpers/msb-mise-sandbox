/**
 * Sandbox lifecycle orchestration.
 *
 * Thin wrapper around the microsandbox TS SDK that applies project config
 * (resources, mounts, network policy, secrets, env vars) and exposes
 * focused lifecycle operations.
 *
 * Lifecycle management (start/stop/remove/list) delegates to the `msb`
 * CLI via child-process wrappers. Sandbox creation, exec, and shell still
 * use the TS SDK because they need the `Sandbox` builder and runtime object.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  Sandbox,
  type ExecOutput,
} from "microsandbox";
import type { ProjectConfig } from "../types.js";
import { buildNetworkPolicy, parsePortSpec, DEFAULT_PORT_BIND } from "./network.js";
import { applySecrets } from "./secrets.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// msb CLI helpers
// ---------------------------------------------------------------------------

const MSB_COMMAND = "msb";

/** Run an msb CLI command and return stdout. */
async function msb(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(MSB_COMMAND, args, {
    timeout: 30_000,
  });
  return stdout;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a memory string ("8G", "4G", "512M") to MiB.
 */
export function parseMemoryMib(value: string): number {
  const m = value.match(/^(\d+)\s*([KMG]?)$/);
  if (!m) throw new Error(`Invalid memory spec "${value}"`);
  const num = parseInt(m[1], 10);
  switch (m[2]) {
    case "K":
      return Math.round(num / 1024);
    case "M":
    case "":
      return num;
    case "G":
      return num * 1024;
    default:
      throw new Error(`Unknown memory unit "${m[2]}"`);
  }
}

// ---------------------------------------------------------------------------
// msb list JSON output shape
// ---------------------------------------------------------------------------

export interface MsbListEntry {
  name: string;
  status: string;
  created_at?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a sandbox from a resolved (defaults-applied) project config.
 *
 * The sandbox name matches the project name so we can look it up later.
 *
 * NOTE: Only the workspace bind mount is created here. Specific subpath
 * mounts (auth sockets, caches, etc.) are deferred to the agent phase so
 * the image toolchain is not masked by a blanket `/root` volume.
 */
export async function createSandbox(
  project: string,
  config: ProjectConfig,
): Promise<Sandbox> {
  // Apply defaults to ensure all fields are present.
  const { applyDefaults } = await import("../types.js");
  const cfg = applyDefaults(config);

  const sb = Sandbox.builder(project);

  // Docker support requires the stock image — only it ships dockerd, the
  // CLI/plugins, and the docker-up helper. Reject before creating anything
  // so a custom image + docker.enabled misconfiguration fails fast with an
  // actionable error instead of an opaque runtime failure.
  const STOCK_IMAGE_REFS = new Set([
    "agent-sandbox:latest",
    "docker.io/library/agent-sandbox:latest",
  ]);
  if (cfg.docker.enabled && !STOCK_IMAGE_REFS.has(cfg.image!)) {
    throw new Error(
      `Project "${project}": Docker support requires the stock ` +
        `agent-sandbox:latest image, but the project image is ` +
        `"${cfg.image}". Remove the "image" field (or set it to ` +
        `"agent-sandbox:latest") before enabling docker.enabled.`,
    );
  }

  // Image
  sb.image(cfg.image!);
  sb.detached(true);
  if (cfg.image === "agent-sandbox:latest" || cfg.image === "docker.io/library/agent-sandbox:latest") {
    sb.pullPolicy("never");
  } else {
    sb.pullPolicy("if-missing");
  }

  // Resources
  sb.cpus(cfg.resources.cpus!);
  sb.memory(parseMemoryMib(cfg.resources.memory!));

  // Docker data volume — a disk-backed /var/lib/docker is required by
  // dockerd (overlay2 cannot stack on the sandbox's overlay rootfs).
  // The volume persists across sandbox removal, preserving images/cache.
  if (cfg.docker.enabled) {
    const dataVolumeName = `${project}-docker-data`;
    const sizeMib = parseMemoryMib(cfg.docker.dataVolumeSize!);
    sb.volume("/var/lib/docker", (v: any) =>
      v.namedWith(dataVolumeName, "ensure-exists", "disk", sizeMib),
    );
  }

  // Mounts
  //   workspace → bind mount from CWD (the host workspace bind source)
  sb.volume(cfg.mounts.workspace!, (v: any) => v.bind(process.cwd()));
  //   root/home → NOT mounted here. A blanket named volume at /root would
  //   mask image content. Agent-phase setup will mount specific subpaths
  //   (auth sockets, caches) individually.

  // Non-secret env vars
  for (const [k, v] of Object.entries(cfg.env)) {
    sb.env(k, v);
  }

  // Secret placeholders (env-var bridge)
  // The real secret value is registered on the NetworkBuilder below.
  for (const secret of cfg.secrets) {
    sb.env(secret.env, `$MSB_${secret.env}`);
  }

  // Network (policy + secrets + TLS + published ports)
  sb.network((nb: any) => {
    // 1. Egress policy from network.allow rules
    const policy = buildNetworkPolicy({
      defaultEgress: cfg.network.defaultEgress!,
      allow: cfg.network.allow!,
    });
    nb.policy(policy);

    // 2. Secrets (v0.6.6 workaround — registered on NetworkBuilder)
    if (cfg.secrets.length > 0) {
      applySecrets(nb, cfg.secrets, cfg.onSecretViolation);
    }

    // 3. Published ports (host → guest forwarding). Per-entry defaults are
    // resolved by parsePortSpec (guestPort=hostPort, protocol="tcp",
    // bind="127.0.0.1"). The loopback default keeps published ports reachable
    // from the host without exposing them on the LAN. The SDK serializes port
    // forwarding on the NetworkBuilder, not the SandboxBuilder, so calls
    // happen here rather than on `sb.port(...)`.
    for (const entry of cfg.ports) {
      const p = parsePortSpec(entry);
      if (p.protocol === "udp") {
        if (p.bind === DEFAULT_PORT_BIND) {
          nb.portUdp(p.hostPort, p.guestPort);
        } else {
          nb.portUdpBind(p.bind, p.hostPort, p.guestPort);
        }
      } else {
        if (p.bind === DEFAULT_PORT_BIND) {
          nb.port(p.hostPort, p.guestPort);
        } else {
          nb.portBind(p.bind, p.hostPort, p.guestPort);
        }
      }
    }

    return nb;
  });

  return sb.create();
}

// ---------------------------------------------------------------------------
// Lifecycle helpers (msb CLI wrappers)
// ---------------------------------------------------------------------------

/** Resume a stopped sandbox in detached mode. */
export async function startSandbox(project: string): Promise<void> {
  await msb(["start", project]);
}

/** Gracefully stop a running sandbox. */
export async function stopSandbox(project: string): Promise<void> {
  await msb(["stop", project]);
}

/** Remove a stopped sandbox from the database. */
export async function removeSandbox(project: string): Promise<void> {
  await msb(["remove", "--force", project]);
}

/** List all sandboxes by parsing `msb list --format json`. */
export async function listSandboxes(): Promise<MsbListEntry[]> {
  const stdout = await msb(["list", "--format", "json"]);
  if (!stdout.trim()) return [];
  return JSON.parse(stdout) as MsbListEntry[];
}

/** List named volumes by parsing `msb volume list --format json`. */
export async function listVolumes(): Promise<string[]> {
  const stdout = await msb(["volume", "list", "--format", "json"]);
  if (!stdout.trim()) return [];
  const arr = JSON.parse(stdout) as Array<{ name?: string }>;
  return arr
    .map((v) => v.name)
    .filter((n): n is string => typeof n === "string");
}

// ---------------------------------------------------------------------------
// Exec / Shell
// ---------------------------------------------------------------------------

/**
 * Execute a command inside a sandbox.
 *
 * Gets or starts the sandbox, runs the command with TTY support, and
 * returns the output.
 */
export async function execInSandbox(
  project: string,
  cmd: string,
  args: string[] = [],
): Promise<ExecOutput> {
  const s = await ensureRunning(project);
  return s.exec(cmd, args);
}

/**
 * Open an interactive shell inside a sandbox.
 *
 * Connects the current terminal to the sandbox's shell. Resolves once
 * the shell exits.
 */
export async function shellInSandbox(project: string): Promise<number> {
  const s = await ensureRunning(project);
  // `attachShell` forwards the terminal TTY and returns the exit PID.
  return s.attachShell();
}

// ---------------------------------------------------------------------------
// Attach (interactive TTY)
// ---------------------------------------------------------------------------

/**
 * Run a command inside the sandbox with the parent TTY attached.
 *
 * Uses `Sandbox.attach()` which forwards stdio to the parent terminal
 * and returns the exit code once the command completes.
 */
export async function attachInSandbox(
  project: string,
  cmd: string,
  args: string[] = [],
): Promise<number> {
  const s = await ensureRunning(project);
  return s.attach(cmd, args);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Get a sandbox, auto-starting if it is stopped.
 */
async function ensureRunning(project: string): Promise<Sandbox> {
  const handle = await Sandbox.get(project);

  if (handle.status === "running") {
    return handle.connect();
  }

  // Sandbox exists but is stopped — start it.
  console.error(`Sandbox "${project}" is ${handle.status}; starting it…`);
  return Sandbox.startDetached(project);
}
