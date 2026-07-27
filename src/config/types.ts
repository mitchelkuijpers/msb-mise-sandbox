/**
 * Strict types for the layered sandbox configuration.
 *
 * Configuration is loaded from four sources and merged deterministically:
 *   1. Built-in defaults (BUILTIN_DEFAULTS below).
 *   2. Personal defaults at ~/.config/mise-msb/config.toml (optional).
 *   3. Project config at <project-root>/.sandbox.toml (optional).
 *   4. CLI overrides (parsed last; highest precedence).
 */

// ---------------------------------------------------------------------------
// Scalars & primitives
// ---------------------------------------------------------------------------

export type Protocol = "tcp" | "udp";
export type EgressPolicy = "deny" | "allow";

/** Memory size with M or G suffix (e.g. "512M", "8G"). */
export type MemorySize = `${number}${"M" | "G"}`;

// ---------------------------------------------------------------------------
// Build settings
// ---------------------------------------------------------------------------

export interface BuildConfig {
  /** Base image reference for `mise oci build --from`. */
  from: string;
  /** Local image tag (e.g. "my-project:dev"). */
  tag: string;
  /** Linux image used on macOS to run `mise oci build`. */
  builderImage: string;
}

// ---------------------------------------------------------------------------
// Runtime settings
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
  /** Number of vCPUs. */
  cpus: number;
  /** Memory size string (e.g. "8G"). */
  memory: MemorySize;
}

// ---------------------------------------------------------------------------
// Mounts
// ---------------------------------------------------------------------------

export type MountKind = "dir" | "file" | "disk" | "named";

export interface MountEntry {
  /** Kind of mount — selects the canonical `msb` mount flag. */
  kind: MountKind;
  /** Host source path (or named volume name). */
  source: string;
  /** Absolute guest path. */
  target: string;
  /** Optional mount options (forwarded verbatim, e.g. "ro"). */
  options?: string;
  /** Source size for `disk` mounts. */
  size?: MemorySize;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface PortEntry {
  /** Host port (1-65535). */
  hostPort: number;
  /** Guest port (defaults to hostPort). */
  guestPort: number;
  /** Protocol (defaults to "tcp"). */
  protocol: Protocol;
  /** Bind address (defaults to "127.0.0.1"). */
  bind: string;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export interface NetworkConfig {
  /** Default egress policy. */
  defaultEgress: EgressPolicy;
  /** Allow rules in `<host>:<protocol>:<port>` format. */
  allow: string[];
  /** If false, drop inherited rules instead of appending. */
  inherit: boolean;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export interface SecretEntry {
  /** Source host environment variable name. */
  from: string;
  /** Allowed destination hosts. */
  hosts: string[];
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CommandSpec {
  /** argv entries (first is the binary). */
  argv: string[];
}

// ---------------------------------------------------------------------------
// Project identity
// ---------------------------------------------------------------------------

export interface IdentityConfig {
  /** Sandbox name. */
  name: string;
  /** Workdir inside the sandbox. */
  workdir: string;
}

// ---------------------------------------------------------------------------
// Top-level merged config
// ---------------------------------------------------------------------------

export interface SandboxConfig {
  identity: IdentityConfig;
  build: BuildConfig;
  runtime: RuntimeConfig;
  /** Workspace mount target inside the sandbox. */
  workdirTarget: string;
  /** Named mounts (sorted by name in argv). */
  mounts: Record<string, MountEntry>;
  /** Named port entries (sorted by name in argv). */
  ports: Record<string, PortEntry>;
  network: NetworkConfig;
  /** Environment variable map (merged later layers override earlier). */
  env: Record<string, string>;
  /** Named secret entries. */
  secrets: Record<string, SecretEntry>;
  /** Default command (overrides only — replaces base). */
  command?: CommandSpec;
  /** Sandbox labels (sorted in argv). */
  labels: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Raw layered input (before defaults are applied, with optional fields)
// ---------------------------------------------------------------------------

export interface PartialBuild {
  from?: string;
  tag?: string;
  builderImage?: string;
}

export interface PartialRuntime {
  cpus?: number;
  memory?: string;
}

export interface PartialMount {
  kind?: MountKind;
  source?: string;
  target?: string;
  options?: string;
  size?: string;
}

export interface PartialPort {
  hostPort?: number;
  guestPort?: number;
  protocol?: string;
  bind?: string;
}

export interface PartialNetwork {
  defaultEgress?: EgressPolicy | string;
  allow?: string[];
  inherit?: boolean;
}

export interface PartialSecret {
  from?: string;
  hosts?: string[];
}

export interface PartialCommand {
  argv?: string[];
}

export interface PartialIdentity {
  name?: string;
  workdir?: string;
}

/**
 * Shape of a single TOML config layer (after parsing, before merge).
 * Every field is optional because the layers may omit sections entirely.
 */
export interface PartialConfig {
  build?: PartialBuild;
  runtime?: PartialRuntime;
  workdir?: string;
  mounts?: Record<string, PartialMount>;
  ports?: Record<string, PartialPort>;
  network?: PartialNetwork;
  env?: Record<string, string>;
  secrets?: Record<string, PartialSecret>;
  command?: PartialCommand;
  labels?: Record<string, string>;
  identity?: PartialIdentity;
}

// ---------------------------------------------------------------------------
// Built-in defaults
// ---------------------------------------------------------------------------

export const BUILTIN_DEFAULTS: SandboxConfig = {
  identity: { name: "", workdir: "/workspace" },
  build: {
    from: "ubuntu:24.04",
    tag: "",
    builderImage: "ubuntu:24.04",
  },
  runtime: { cpus: 4, memory: "8G" },
  workdirTarget: "/workspace",
  mounts: {},
  ports: {},
  network: {
    defaultEgress: "allow",
    allow: [],
    inherit: true,
  },
  env: {},
  secrets: {},
  labels: {},
};
