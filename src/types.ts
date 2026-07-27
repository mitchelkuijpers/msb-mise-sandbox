/**
 * Type definitions for the agent-sandbox project registry.
 *
 * Projects are stored in ~/.agent-sandbox/projects.json as a map of
 * project name → ProjectConfig.
 */

// ---------------------------------------------------------------------------
// Project Registry
// ---------------------------------------------------------------------------

/** Top-level registry file shape. */
export interface ProjectRegistry {
  projects: Record<string, ProjectConfig>;
}

// ---------------------------------------------------------------------------
// Project Configuration
// ---------------------------------------------------------------------------

export interface ProjectConfig {
  /** OCI image reference to boot for this project. */
  image?: string;

  /** GitLab project connection details. */
  gitlab: GitLabConfig;

  /** Secret entries — sensitive values injected as placeholders. */
  secrets?: SecretEntry[];

  /** Non-sensitive environment variables passed as-is to the sandbox. */
  env?: Record<string, string>;

  /** Network policy configuration. */
  network?: NetworkConfig;

  /** Resource limits for the sandbox microVM. */
  resources?: ResourceLimits;

  /** Mount configuration for workspace and root filesystems. */
  mounts?: MountConfig;

  /** Docker-in-sandbox support (requires the stock agent-sandbox image). */
  docker?: DockerConfig;

  /**
   * Host→guest port publishing entries. Each entry instructs the runtime to
   * forward a host port into the guest microVM. Per-entry defaults (guest
   * port = host port, protocol = "tcp", bind = "127.0.0.1") are resolved at
   * the builder call site, not here.
   */
  ports?: PortSpec[];

  /**
   * Action to take when a secret placeholder would be sent to a
   * non-allowed host.
   *
   * - `"block"`: request is blocked, sandbox continues (default).
   * - `"block-and-log"`: request is blocked and violation logged.
   * - `"block-and-terminate"`: sandbox is terminated on violation.
   */
  onSecretViolation?: SecretViolationPolicy;
}

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------

export interface GitLabConfig {
  /** GitLab instance URL (e.g. https://gitlab.com). */
  url: string;
  /**
   * Reference to the source of the GitLab token.
   * Typically "env:GITLAB_TOKEN" for a host environment variable.
   */
  tokenRef: string;
}

export interface SecretEntry {
  /**
   * Environment variable name the tool expects inside the sandbox.
   * This becomes the placeholder name (e.g. "GITLAB_TOKEN"
   * → "$MSB_GITLAB_TOKEN").
   */
  env: string;

  /**
   * Source of the secret value on the host.
   * Format: "env:VARIABLE_NAME" to read from the host environment.
   */
  from: string;

  /**
   * Host(s) allowed to receive this secret.
   * Single domain string or array of domain strings.
   */
  allow: string | string[];
}

export interface NetworkConfig {
  /**
   * Default egress policy.
   * - `"deny"`: deny-by-default (block all egress unless allowed).
   * - `"allow"`: allow-by-default (permit all egress).
   *
   * Default: `"deny"`.
   */
  defaultEgress?: EgressPolicy;

  /**
   * Explicit egress allow rules.
   * Format: `"<host>:<protocol>:<port>"` (e.g. "gitlab.com:tcp:443").
   */
  allow?: string[];
}

export interface ResourceLimits {
  /** Number of CPU cores (default: 4). */
  cpus?: number;
  /** Memory limit (default: "8G"). */
  memory?: string;
}

export interface MountConfig {
  /** Workspace mount point inside the sandbox (default: "/workspace"). */
  workspace?: string;
  /** Root/home volume mount point (default: "/root"). */
  root?: string;
}

export interface DockerConfig {
  /**
   * Enable Docker-in-sandbox support. When true, sandbox creation mounts a
   * disk-backed named volume at /var/lib/docker (required for dockerd).
   * Only valid with the stock agent-sandbox image (default: false).
   */
  enabled?: boolean;

  /**
   * Size of the /var/lib/docker data volume: a positive integer with an
   * uppercase M (MiB) or G (GiB) suffix, minimum 1024 MiB (default: "10G").
   */
  dataVolumeSize?: string;
}

/**
 * Published host→guest port forwarding entry.
 *
 * Per-entry defaults are resolved by `parsePortSpec` at the builder call
 * site (in `src/lib/network.ts`): `guestPort` defaults to `hostPort`,
 * `protocol` defaults to `"tcp"`, `bind` defaults to `"127.0.0.1"`.
 */
export interface PortSpec {
  /** Host-side port (1-65535). */
  hostPort: number;

  /** Guest-side port (1-65535, defaults to `hostPort`). */
  guestPort?: number;

  /** `"tcp"` or `"udp"` (defaults to `"tcp"`). */
  protocol?: "tcp" | "udp";

  /** Host bind address (defaults to `"127.0.0.1"` for loopback-only). */
  bind?: string;
}

// ---------------------------------------------------------------------------
// Enums / Literal Unions
// ---------------------------------------------------------------------------

export type SecretViolationPolicy =
  | "block"
  | "block-and-log"
  | "block-and-terminate";

export type EgressPolicy = "allow" | "deny";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  image: "agent-sandbox:latest",
  resources: { cpus: 4, memory: "8G" } as ResourceLimits,
  mounts: { workspace: "/workspace", root: "/root" } as MountConfig,
  network: { defaultEgress: "deny" as EgressPolicy },
  docker: { enabled: false, dataVolumeSize: "10G" } as DockerConfig,
  ports: [] as PortSpec[],
  onSecretViolation: "block" as SecretViolationPolicy,
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * Apply default values for omitted optional fields in a ProjectConfig.
 * Returns a new object — does not mutate the input.
 */
export function applyDefaults(config: ProjectConfig): Required<ProjectConfig> {
  return {
    ...config,
    image: config.image ?? DEFAULTS.image,
    resources: { ...DEFAULTS.resources, ...config.resources },
    mounts: { ...DEFAULTS.mounts, ...config.mounts },
    network: {
      ...DEFAULTS.network,
      ...config.network,
      allow: config.network?.allow ?? [],
    },
    secrets: config.secrets ?? [],
    env: config.env ?? {},
    docker: { ...DEFAULTS.docker, ...config.docker },
    ports: config.ports ?? [],
    onSecretViolation:
      config.onSecretViolation ?? DEFAULTS.onSecretViolation,
  } as Required<ProjectConfig>;
}
