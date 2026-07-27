/**
 * Validation utilities for the layered configuration.
 *
 * Validation is intentionally strict — unknown keys, malformed values,
 * and impossible combinations fail loudly with a file path and field path
 * before any external command executes.
 */

import type {
  MemorySize,
  PartialConfig,
  Protocol,
  SandboxConfig,
} from "./types.js";

export class ConfigValidationError extends Error {
  readonly fieldPath: string;
  readonly sourceFile: string | undefined;
  constructor(
    message: string,
    fieldPath: string,
    sourceFile?: string,
  ) {
    const prefix = sourceFile !== undefined ? `${sourceFile}: ` : "";
    super(`${prefix}${fieldPath}: ${message}`);
    this.name = "ConfigValidationError";
    this.fieldPath = fieldPath;
    this.sourceFile = sourceFile;
  }
}

// ---------------------------------------------------------------------------
// Field-level validators
// ---------------------------------------------------------------------------

const VALID_PROTOCOLS: ReadonlySet<string> = new Set(["tcp", "udp"]);
const MEMORY_RE = /^(\d+)([MG])$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NETWORK_RULE_RE = /^[A-Za-z0-9._*:-]+:tcp:\d+$|^[A-Za-z0-9._*:-]+:udp:\d+$/;
const CLI_SAFE_RE = /^[A-Za-z0-9._:@/-]+$/;

export function isValidMemory(value: string): value is MemorySize {
  return MEMORY_RE.test(value);
}

export function isValidEnvName(name: string): boolean {
  return ENV_NAME_RE.test(name);
}

export function isValidNetworkRule(rule: string): boolean {
  return NETWORK_RULE_RE.test(rule);
}

export function isCliSafe(value: string): boolean {
  return CLI_SAFE_RE.test(value);
}

export function isAbsoluteGuestPath(value: string): boolean {
  return value.startsWith("/");
}

// ---------------------------------------------------------------------------
// Top-level validation
// ---------------------------------------------------------------------------

export interface LayerSource {
  source: string;
  config?: PartialConfig | undefined;
}

export function validateLayers(layers: ReadonlyArray<LayerSource>): void {
  for (const layer of layers) {
    if (layer.config !== undefined) {
      validatePartial(layer.config, layer.source);
    }
  }
}

export function validatePartial(
  config: PartialConfig,
  sourceFile?: string,
): void {
  // Reject unknown top-level keys.
  const allowedTopLevel = new Set([
    "build",
    "runtime",
    "workdir",
    "mounts",
    "ports",
    "network",
    "env",
    "secrets",
    "command",
    "labels",
    "identity",
  ]);
  for (const key of Object.keys(config)) {
    if (!allowedTopLevel.has(key)) {
      throw new ConfigValidationError(
        `unknown top-level key "${key}"`,
        key,
        sourceFile,
      );
    }
  }

  if (config.build !== undefined) {
    const allowedBuild = new Set(["from", "tag", "builderImage"]);
    for (const key of Object.keys(config.build)) {
      if (!allowedBuild.has(key)) {
        throw new ConfigValidationError(
          `unknown build key "${key}"`,
          `build.${key}`,
          sourceFile,
        );
      }
    }
    if (config.build.from !== undefined && config.build.from.length === 0) {
      throw new ConfigValidationError(
        "build.from must not be empty",
        "build.from",
        sourceFile,
      );
    }
    if (config.build.tag !== undefined && config.build.tag.length > 0) {
      if (!isCliSafe(config.build.tag)) {
        throw new ConfigValidationError(
          "build.tag contains characters not safe for CLI use",
          "build.tag",
          sourceFile,
        );
      }
    }
    if (
      config.build.builderImage !== undefined &&
      config.build.builderImage.length === 0
    ) {
      throw new ConfigValidationError(
        "build.builderImage must not be empty",
        "build.builderImage",
        sourceFile,
      );
    }
  }

  if (config.runtime !== undefined) {
    const allowedRuntime = new Set(["cpus", "memory"]);
    for (const key of Object.keys(config.runtime)) {
      if (!allowedRuntime.has(key)) {
        throw new ConfigValidationError(
          `unknown runtime key "${key}"`,
          `runtime.${key}`,
          sourceFile,
        );
      }
    }
    if (config.runtime.cpus !== undefined) {
      if (!Number.isInteger(config.runtime.cpus) || config.runtime.cpus <= 0) {
        throw new ConfigValidationError(
          "runtime.cpus must be a positive integer",
          "runtime.cpus",
          sourceFile,
        );
      }
    }
    if (config.runtime.memory !== undefined) {
      if (!isValidMemory(config.runtime.memory)) {
        throw new ConfigValidationError(
          'runtime.memory must match /^\\d+[MG]$/',
          "runtime.memory",
          sourceFile,
        );
      }
    }
  }
  if (config.build !== undefined) {
    if (config.build.from !== undefined && config.build.from.length === 0) {
      throw new ConfigValidationError(
        "build.from must not be empty",
        "build.from",
        sourceFile,
      );
    }
    if (config.build.tag !== undefined && config.build.tag.length > 0) {
      if (!isCliSafe(config.build.tag)) {
        throw new ConfigValidationError(
          "build.tag contains characters not safe for CLI use",
          "build.tag",
          sourceFile,
        );
      }
    }
    if (
      config.build.builderImage !== undefined &&
      config.build.builderImage.length === 0
    ) {
      throw new ConfigValidationError(
        "build.builderImage must not be empty",
        "build.builderImage",
        sourceFile,
      );
    }
  }

  if (config.runtime !== undefined) {
    if (config.runtime.cpus !== undefined) {
      if (!Number.isInteger(config.runtime.cpus) || config.runtime.cpus <= 0) {
        throw new ConfigValidationError(
          "runtime.cpus must be a positive integer",
          "runtime.cpus",
          sourceFile,
        );
      }
    }
    if (config.runtime.memory !== undefined) {
      if (!isValidMemory(config.runtime.memory)) {
        throw new ConfigValidationError(
          'runtime.memory must match /^\\d+[MG]$/',
          "runtime.memory",
          sourceFile,
        );
      }
    }
  }

  if (config.workdir !== undefined && !isAbsoluteGuestPath(config.workdir)) {
    throw new ConfigValidationError(
      "workdir must be an absolute guest path",
      "workdir",
      sourceFile,
    );
  }

  if (config.env !== undefined) {
    for (const [name, value] of Object.entries(config.env)) {
      if (!isValidEnvName(name)) {
        throw new ConfigValidationError(
          `invalid environment variable name "${name}"`,
          `env.${name}`,
          sourceFile,
        );
      }
      if (typeof value !== "string") {
        throw new ConfigValidationError(
          "env values must be strings",
          `env.${name}`,
          sourceFile,
        );
      }
    }
  }

  if (config.labels !== undefined) {
    for (const name of Object.keys(config.labels)) {
      if (!isValidEnvName(name) && !isCliSafe(name)) {
        throw new ConfigValidationError(
          `invalid label key "${name}"`,
          `labels.${name}`,
          sourceFile,
        );
      }
    }
  }

  if (config.mounts !== undefined) {
    for (const [name, entry] of Object.entries(config.mounts)) {
      validateMountEntry(entry, `mounts.${name}`, sourceFile);
    }
  }

  if (config.ports !== undefined) {
    for (const [name, entry] of Object.entries(config.ports)) {
      validatePortEntry(entry, `ports.${name}`, sourceFile);
    }
  }

  if (config.network !== undefined) {
    validateNetworkEntry(config.network, sourceFile);
  }

  if (config.secrets !== undefined) {
    for (const [name, entry] of Object.entries(config.secrets)) {
      validateSecretEntry(entry, `secrets.${name}`, sourceFile);
    }
  }

  if (config.identity !== undefined) {
    if (
      config.identity.name !== undefined &&
      config.identity.name.length > 0 &&
      !isCliSafe(config.identity.name)
    ) {
      throw new ConfigValidationError(
        "identity.name contains characters not safe for CLI use",
        "identity.name",
        sourceFile,
      );
    }
    if (
      config.identity.workdir !== undefined &&
      !isAbsoluteGuestPath(config.identity.workdir)
    ) {
      throw new ConfigValidationError(
        "identity.workdir must be an absolute guest path",
        "identity.workdir",
        sourceFile,
      );
    }
  }

  if (config.command !== undefined) {
    if (config.command.argv !== undefined) {
      if (!Array.isArray(config.command.argv)) {
        throw new ConfigValidationError(
          "command.argv must be an array",
          "command.argv",
          sourceFile,
        );
      }
      for (const entry of config.command.argv) {
        if (typeof entry !== "string") {
          throw new ConfigValidationError(
            "command.argv entries must be strings",
            "command.argv",
            sourceFile,
          );
        }
      }
    }
  }
}

function validateMountEntry(
  entry: PartialConfig["mounts"] extends Record<string, infer V> | undefined
    ? V
    : never,
  fieldPath: string,
  sourceFile?: string,
): void {
  if (entry === undefined) return;
  const kinds = ["dir", "file", "disk", "named"] as const;
  if (entry.kind !== undefined && !kinds.includes(entry.kind as (typeof kinds)[number])) {
    throw new ConfigValidationError(
      `mount kind must be one of ${kinds.join(", ")}`,
      `${fieldPath}.kind`,
      sourceFile,
    );
  }
  if (entry.source !== undefined && entry.source.length === 0) {
    throw new ConfigValidationError(
      "source must not be empty",
      `${fieldPath}.source`,
      sourceFile,
    );
  }
  if (entry.target !== undefined && !isAbsoluteGuestPath(entry.target)) {
    throw new ConfigValidationError(
      "mount target must be an absolute guest path",
      `${fieldPath}.target`,
      sourceFile,
    );
  }
  if (entry.size !== undefined && !isValidMemory(entry.size)) {
    throw new ConfigValidationError(
      'mount size must match /^\\d+[MG]$/',
      `${fieldPath}.size`,
      sourceFile,
    );
  }
}

function validatePortEntry(
  entry: PartialConfig["ports"] extends Record<string, infer V> | undefined
    ? V
    : never,
  fieldPath: string,
  sourceFile?: string,
): void {
  if (entry === undefined) return;
  if (entry.hostPort !== undefined) {
    if (
      !Number.isInteger(entry.hostPort) ||
      entry.hostPort < 1 ||
      entry.hostPort > 65535
    ) {
      throw new ConfigValidationError(
        "hostPort must be an integer in 1..65535",
        `${fieldPath}.hostPort`,
        sourceFile,
      );
    }
  }
  if (entry.guestPort !== undefined) {
    if (
      !Number.isInteger(entry.guestPort) ||
      entry.guestPort < 1 ||
      entry.guestPort > 65535
    ) {
      throw new ConfigValidationError(
        "guestPort must be an integer in 1..65535",
        `${fieldPath}.guestPort`,
        sourceFile,
      );
    }
  }
  if (entry.protocol !== undefined) {
    if (!VALID_PROTOCOLS.has(entry.protocol)) {
      throw new ConfigValidationError(
        'protocol must be "tcp" or "udp"',
        `${fieldPath}.protocol`,
        sourceFile,
      );
    }
  }
  if (entry.bind !== undefined && entry.bind.length === 0) {
    throw new ConfigValidationError(
      "bind must not be empty",
      `${fieldPath}.bind`,
      sourceFile,
    );
  }
}

function validateNetworkEntry(
  entry: PartialConfig["network"],
  sourceFile?: string,
): void {
  if (entry === undefined) return;
  if (
    entry.defaultEgress !== undefined &&
    entry.defaultEgress !== "deny" &&
    entry.defaultEgress !== "allow"
  ) {
    throw new ConfigValidationError(
      'network.defaultEgress must be "deny" or "allow"',
      "network.defaultEgress",
      sourceFile,
    );
  }
  if (entry.allow !== undefined) {
    if (!Array.isArray(entry.allow)) {
      throw new ConfigValidationError(
        "network.allow must be an array",
        "network.allow",
        sourceFile,
      );
    }
    for (const [i, rule] of entry.allow.entries()) {
      if (typeof rule !== "string" || !isValidNetworkRule(rule)) {
        throw new ConfigValidationError(
          `network.allow[${i}] must match "<host>:<proto>:<port>"`,
          `network.allow[${i}]`,
          sourceFile,
        );
      }
    }
  }
  if (entry.inherit !== undefined && typeof entry.inherit !== "boolean") {
    throw new ConfigValidationError(
      "network.inherit must be a boolean",
      "network.inherit",
      sourceFile,
    );
  }
}

function validateSecretEntry(
  entry: PartialConfig["secrets"] extends Record<string, infer V> | undefined
    ? V
    : never,
  fieldPath: string,
  sourceFile?: string,
): void {
  if (entry === undefined) return;
  if (entry.from !== undefined && !isValidEnvName(entry.from)) {
    throw new ConfigValidationError(
      `secret source must be a valid environment variable name`,
      `${fieldPath}.from`,
      sourceFile,
    );
  }
  if (entry.hosts !== undefined) {
    if (!Array.isArray(entry.hosts)) {
      throw new ConfigValidationError(
        "secrets.hosts must be an array",
        `${fieldPath}.hosts`,
        sourceFile,
      );
    }
    for (const [i, host] of entry.hosts.entries()) {
      if (typeof host !== "string" || host.length === 0) {
        throw new ConfigValidationError(
          `secrets.hosts[${i}] must be a non-empty string`,
          `${fieldPath}.hosts[${i}]`,
          sourceFile,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Post-merge validation (verifies the resolved config is internally sound)
// ---------------------------------------------------------------------------

export function validateMerged(config: SandboxConfig): void {
  // Project identity must resolve to a CLI-safe name.
  if (config.identity.name.length === 0 || !isCliSafe(config.identity.name)) {
    throw new ConfigValidationError(
      `identity.name "${config.identity.name}" is not CLI-safe`,
      "identity.name",
    );
  }
  if (!Number.isInteger(config.runtime.cpus) || config.runtime.cpus <= 0) {
    throw new ConfigValidationError(
      "runtime.cpus must be a positive integer",
      "runtime.cpus",
    );
  }
  if (!isValidMemory(config.runtime.memory)) {
    throw new ConfigValidationError(
      'runtime.memory must match /^\\d+[MG]$/',
      "runtime.memory",
    );
  }
  if (config.build.tag.length === 0) {
    throw new ConfigValidationError(
      "build.tag must not be empty (derive a name from the project root)",
      "build.tag",
    );
  }
  if (!isCliSafe(config.build.tag)) {
    throw new ConfigValidationError(
      "build.tag contains characters not safe for CLI use",
      "build.tag",
    );
  }
  for (const [name, port] of Object.entries(config.ports)) {
    if (port.protocol !== "tcp" && port.protocol !== "udp") {
      throw new ConfigValidationError(
        `port "${name}" has invalid protocol "${port.protocol}"`,
        `ports.${name}.protocol`,
      );
    }
  }
  for (const rule of config.network.allow) {
    if (!isValidNetworkRule(rule)) {
      throw new ConfigValidationError(
        `network rule "${rule}" is malformed`,
        "network.allow",
      );
    }
  }
  for (const [name, secret] of Object.entries(config.secrets)) {
    if (!isValidEnvName(secret.from)) {
      throw new ConfigValidationError(
        `secret "${name}" source "${secret.from}" is not a valid env name`,
        `secrets.${name}.from`,
      );
    }
    if (secret.hosts.length === 0) {
      throw new ConfigValidationError(
        `secret "${name}" must list at least one allowed host`,
        `secrets.${name}.hosts`,
      );
    }
  }
}
