/**
 * Project registry configuration loader and writer.
 *
 * Manages ~/.agent-sandbox/projects.json — a typed JSON file that stores
 * per-project sandbox configuration (GitLab connection, secrets, env vars,
 * network rules, resource limits, mounts).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  type ProjectConfig,
  type ProjectRegistry,
  ConfigValidationError,
  applyDefaults,
} from "../types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Directory containing the project registry file. */
export function registryDir(): string {
  if (process.env.AGENT_SANDBOX_HOME) {
    return process.env.AGENT_SANDBOX_HOME;
  }

  return path.join(os.homedir(), ".agent-sandbox");
}

/** Full path to the projects.json registry file. */
export function registryPath(): string {
  return path.join(registryDir(), "projects.json");
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load the full project registry from disk.
 *
 * Returns an empty registry if the file does not exist.
 * Throws ConfigValidationError if the file exists but is malformed or
 * fails schema validation.
 */
export function loadRegistry(): ProjectRegistry {
  const fp = registryPath();

  if (!fs.existsSync(fp)) {
    return { projects: {} };
  }

  let raw: unknown;
  try {
    const content = fs.readFileSync(fp, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    throw new ConfigValidationError(
      `Failed to parse registry file at ${fp}: ${(err as Error).message}`,
    );
  }

  const registry = validateRegistry(raw);
  return registry;
}

/**
 * Load a single project config by name.
 *
 * Returns the project config with defaults applied.
 * Throws ConfigValidationError if the project does not exist.
 */
export function loadProject(name: string): ProjectConfig {
  const registry = loadRegistry();
  const config = registry.projects[name];
  if (!config) {
    throw new ConfigValidationError(
      `Project "${name}" not found in registry at ${registryPath()}`,
    );
  }
  return applyDefaults(config);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write the full registry to disk, creating the directory if needed.
 */
export function writeRegistry(registry: ProjectRegistry): void {
  const dir = registryDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const fp = registryPath();
  fs.writeFileSync(fp, JSON.stringify(registry, null, 2) + "\n", {
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

/**
 * Add a project to the registry.
 * Throws ConfigValidationError if a project with the same name exists.
 */
export function addProject(name: string, config: ProjectConfig): void {
  const registry = loadRegistry();
  if (registry.projects[name]) {
    throw new ConfigValidationError(
      `Project "${name}" already exists in the registry.`,
    );
  }
  registry.projects[name] = config;
  writeRegistry(registry);
}

/**
 * Remove a project from the registry.
 * Throws ConfigValidationError if the project does not exist.
 */
export function removeProject(name: string): void {
  const registry = loadRegistry();
  if (!registry.projects[name]) {
    throw new ConfigValidationError(
      `Project "${name}" not found in the registry.`,
    );
  }
  delete registry.projects[name];
  writeRegistry(registry);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an unknown value as a ProjectRegistry.
 * Returns the validated registry or throws ConfigValidationError.
 */
export function validateRegistry(raw: unknown): ProjectRegistry {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigValidationError(
      "Registry must be a JSON object with a 'projects' field.",
    );
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.projects || typeof obj.projects !== "object") {
    throw new ConfigValidationError(
      "Registry is missing required field 'projects' (must be an object).",
    );
  }

  const projects = obj.projects as Record<string, unknown>;

  for (const [name, entry] of Object.entries(projects)) {
    if (typeof entry !== "object" || entry === null) {
      throw new ConfigValidationError(
        `Project "${name}" must be an object.`,
      );
    }
    validateProjectConfig(name, entry as Record<string, unknown>);
  }

  return { projects: projects as Record<string, ProjectConfig> };
}

/**
 * Validate a single project config entry, returning normalized errors.
 */
function validateProjectConfig(
  name: string,
  entry: Record<string, unknown>,
): void {
  if (entry.image !== undefined && (typeof entry.image !== "string" || entry.image.trim() === "")) {
    throw new ConfigValidationError(
      `Project "${name}": 'image' must be a non-empty string.`,
    );
  }

  // gitlab is required
  if (!entry.gitlab || typeof entry.gitlab !== "object") {
    throw new ConfigValidationError(
      `Project "${name}" is missing required field 'gitlab'.`,
    );
  }

  const gitlab = entry.gitlab as Record<string, unknown>;
  if (typeof gitlab.url !== "string" || gitlab.url.trim() === "") {
    throw new ConfigValidationError(
      `Project "${name}": 'gitlab.url' must be a non-empty string.`,
    );
  }
  if (typeof gitlab.tokenRef !== "string" || gitlab.tokenRef.trim() === "") {
    throw new ConfigValidationError(
      `Project "${name}": 'gitlab.tokenRef' must be a non-empty string.`,
    );
  }

  // secrets — optional, but if present must be an array
  if (
    entry.secrets !== undefined &&
    !Array.isArray(entry.secrets)
  ) {
    throw new ConfigValidationError(
      `Project "${name}": 'secrets' must be an array.`,
    );
  }

  if (Array.isArray(entry.secrets)) {
    for (let i = 0; i < entry.secrets.length; i++) {
      const s = entry.secrets[i] as Record<string, unknown> | undefined;
      if (typeof s !== "object" || s === null) {
        throw new ConfigValidationError(
          `Project "${name}": secrets[${i}] must be an object.`,
        );
      }
      if (typeof s.env !== "string" || s.env.trim() === "") {
        throw new ConfigValidationError(
          `Project "${name}": secrets[${i}].env must be a non-empty string.`,
        );
      }
      if (typeof s.from !== "string" || s.from.trim() === "") {
        throw new ConfigValidationError(
          `Project "${name}": secrets[${i}].from must be a non-empty string.`,
        );
      }
      if (
        typeof s.allow !== "string" &&
        !(Array.isArray(s.allow) && s.allow.every((a: unknown) => typeof a === "string"))
      ) {
        throw new ConfigValidationError(
          `Project "${name}": secrets[${i}].allow must be a string or array of strings.`,
        );
      }
    }
  }

  // env — optional, but if present must be an object with string values
  if (entry.env !== undefined) {
    if (typeof entry.env !== "object" || entry.env === null) {
      throw new ConfigValidationError(
        `Project "${name}": 'env' must be an object.`,
      );
    }
    for (const [k, v] of Object.entries(entry.env as Record<string, unknown>)) {
      if (typeof v !== "string") {
        throw new ConfigValidationError(
          `Project "${name}": env["${k}"] must be a string.`,
        );
      }
    }
  }

  // network — optional
  if (entry.network !== undefined) {
    if (typeof entry.network !== "object" || entry.network === null) {
      throw new ConfigValidationError(
        `Project "${name}": 'network' must be an object.`,
      );
    }
    const net = entry.network as Record<string, unknown>;
    if (
      net.defaultEgress !== undefined &&
      net.defaultEgress !== "allow" &&
      net.defaultEgress !== "deny"
    ) {
      throw new ConfigValidationError(
        `Project "${name}": 'network.defaultEgress' must be "allow" or "deny".`,
      );
    }
    if (net.allow !== undefined) {
      if (!Array.isArray(net.allow)) {
        throw new ConfigValidationError(
          `Project "${name}": 'network.allow' must be an array.`,
        );
      }
      for (let i = 0; i < net.allow.length; i++) {
        if (typeof net.allow[i] !== "string") {
          throw new ConfigValidationError(
            `Project "${name}": network.allow[${i}] must be a string.`,
          );
        }
      }
    }
  }

  // resources — optional
  if (entry.resources !== undefined) {
    if (typeof entry.resources !== "object" || entry.resources === null) {
      throw new ConfigValidationError(
        `Project "${name}": 'resources' must be an object.`,
      );
    }
    const res = entry.resources as Record<string, unknown>;
    if (res.cpus !== undefined && typeof res.cpus !== "number") {
      throw new ConfigValidationError(
        `Project "${name}": 'resources.cpus' must be a number.`,
      );
    }
    if (res.memory !== undefined && typeof res.memory !== "string") {
      throw new ConfigValidationError(
        `Project "${name}": 'resources.memory' must be a string.`,
      );
    }
  }

  // mounts — optional
  if (entry.mounts !== undefined) {
    if (typeof entry.mounts !== "object" || entry.mounts === null) {
      throw new ConfigValidationError(
        `Project "${name}": 'mounts' must be an object.`,
      );
    }
    const mnt = entry.mounts as Record<string, unknown>;
    if (mnt.workspace !== undefined && typeof mnt.workspace !== "string") {
      throw new ConfigValidationError(
        `Project "${name}": 'mounts.workspace' must be a string.`,
      );
    }
    if (mnt.root !== undefined && typeof mnt.root !== "string") {
      throw new ConfigValidationError(
        `Project "${name}": 'mounts.root' must be a string.`,
      );
    }
  }

  // onSecretViolation — optional
  if (entry.onSecretViolation !== undefined) {
    const allowed = ["block", "block-and-log", "block-and-terminate"];
    if (!allowed.includes(entry.onSecretViolation as string)) {
      throw new ConfigValidationError(
        `Project "${name}": 'onSecretViolation' must be one of: ${allowed.join(", ")}.`,
      );
    }
  }

  // docker — optional
  if (entry.docker !== undefined) {
    if (typeof entry.docker !== "object" || entry.docker === null) {
      throw new ConfigValidationError(
        `Project "${name}": 'docker' must be an object.`,
      );
    }
    const docker = entry.docker as Record<string, unknown>;
    if (docker.enabled !== undefined && typeof docker.enabled !== "boolean") {
      throw new ConfigValidationError(
        `Project "${name}": 'docker.enabled' must be a boolean.`,
      );
    }
    if (docker.dataVolumeSize !== undefined) {
      if (typeof docker.dataVolumeSize !== "string") {
        throw new ConfigValidationError(
          `Project "${name}": 'docker.dataVolumeSize' must be a string.`,
        );
      }
      validateDataVolumeSize(name, docker.dataVolumeSize);
    }
  }
}

// ---------------------------------------------------------------------------
// docker.dataVolumeSize grammar
// ---------------------------------------------------------------------------

/** Minimum Docker data volume size in MiB (1 GiB). */
export const DOCKER_DATA_VOLUME_MIN_MIB = 1024;

const DATA_VOLUME_SIZE_RE = /^(\d+)([MG])$/;

/**
 * Validate a `docker.dataVolumeSize` value: a positive integer with an
 * uppercase M (MiB) or G (GiB) suffix, at least 1024 MiB.
 */
function validateDataVolumeSize(name: string, value: string): void {
  const m = value.match(DATA_VOLUME_SIZE_RE);
  if (!m) {
    throw new ConfigValidationError(
      `Project "${name}": 'docker.dataVolumeSize' has invalid value "${value}": ` +
        `expected a positive integer with an uppercase M (MiB) or G (GiB) suffix, e.g. "10G".`,
    );
  }
  const mib = m[2] === "G" ? Number(m[1]) * 1024 : Number(m[1]);
  if (mib < DOCKER_DATA_VOLUME_MIN_MIB) {
    throw new ConfigValidationError(
      `Project "${name}": 'docker.dataVolumeSize' value "${value}" is below ` +
        `the minimum size of ${DOCKER_DATA_VOLUME_MIN_MIB} MiB (1G).`,
    );
  }
}
