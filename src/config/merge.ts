/**
 * Deterministic merge rules for layered TOML configuration.
 *
 * Layer order (low → high precedence): built-in defaults → personal → project → CLI.
 *
 * Per-section rules (see design.md D2):
 *   - scalars (string, number): last non-empty wins
 *   - env (record): deep merge, later keys override earlier
 *   - named tables (mounts, ports, secrets): merge by name, later entry
 *     replaces a conflicting earlier entry
 *   - network.allow: append with deduplication, unless overlay sets
 *     network.inherit = false (in which case its rules replace inherited ones)
 *   - command arrays: replace, do not concatenate
 *
 * The merge is a pure function of its inputs — identical layers produce
 * identical merged output, and argv generators see sorted named entries.
 */

import {
  BUILTIN_DEFAULTS,
  type EgressPolicy,
  type PartialConfig,
  type Protocol,
  type SandboxConfig,
} from "./types.js";
import { mergeRecord } from "./records.js";

/** Merge an ordered list of partial configs on top of the built-in defaults. */
export function mergeConfigs(layers: PartialConfig[]): SandboxConfig {
  let acc: SandboxConfig = cloneDefaults();
  for (const layer of layers) {
    acc = mergeLayer(acc, layer);
  }
  return acc;
}

function cloneDefaults(): SandboxConfig {
  return {
    identity: { ...BUILTIN_DEFAULTS.identity },
    build: { ...BUILTIN_DEFAULTS.build },
    runtime: { ...BUILTIN_DEFAULTS.runtime },
    workdirTarget: BUILTIN_DEFAULTS.workdirTarget,
    mounts: {},
    ports: {},
    network: {
      defaultEgress: BUILTIN_DEFAULTS.network.defaultEgress,
      allow: [],
      inherit: BUILTIN_DEFAULTS.network.inherit,
    },
    env: {},
    secrets: {},
    labels: {},
  };
}

function mergeLayer(base: SandboxConfig, overlay: PartialConfig): SandboxConfig {
  const next: SandboxConfig = {
    identity: { ...base.identity },
    build: { ...base.build },
    runtime: { ...base.runtime },
    workdirTarget: base.workdirTarget,
    mounts: { ...base.mounts },
    ports: { ...base.ports },
    network: {
      defaultEgress: base.network.defaultEgress,
      allow: [...base.network.allow],
      inherit: base.network.inherit,
    },
    env: { ...base.env },
    secrets: { ...base.secrets },
    labels: { ...base.labels },
  };

  if (overlay.identity !== undefined) {
    if (overlay.identity.name !== undefined) {
      next.identity.name = overlay.identity.name;
    }
    if (overlay.identity.workdir !== undefined) {
      next.identity.workdir = overlay.identity.workdir;
    }
  }

  if (overlay.build !== undefined) {
    if (overlay.build.from !== undefined && overlay.build.from.length > 0) {
      next.build.from = overlay.build.from;
    }
    if (overlay.build.tag !== undefined && overlay.build.tag.length > 0) {
      next.build.tag = overlay.build.tag;
    }
    if (
      overlay.build.builderImage !== undefined &&
      overlay.build.builderImage.length > 0
    ) {
      next.build.builderImage = overlay.build.builderImage;
    }
  }

  if (overlay.runtime !== undefined) {
    if (overlay.runtime.cpus !== undefined) {
      next.runtime.cpus = overlay.runtime.cpus;
    }
    if (overlay.runtime.memory !== undefined && overlay.runtime.memory.length > 0) {
      next.runtime.memory = overlay.runtime.memory as `${number}${"M" | "G"}`;
    }
  }

  if (overlay.workdir !== undefined && overlay.workdir.length > 0) {
    next.workdirTarget = overlay.workdir;
    if (next.identity.workdir === "/workspace") {
      next.identity.workdir = overlay.workdir;
    }
  }

  if (overlay.env !== undefined) {
    next.env = { ...next.env, ...overlay.env };
  }

  if (overlay.labels !== undefined) {
    next.labels = mergeRecord(next.labels, overlay.labels);
  }

  if (overlay.mounts !== undefined) {
    for (const [name, entry] of Object.entries(overlay.mounts)) {
      if (entry === undefined) continue;
      const prev = next.mounts[name];
      next.mounts[name] = {
        kind: entry.kind ?? prev?.kind ?? "dir",
        source: entry.source ?? prev?.source ?? "",
        target: entry.target ?? prev?.target ?? "",
        options: entry.options ?? prev?.options,
        size: (entry.size ?? prev?.size) as `${number}${"M" | "G"}` | undefined,
      };
    }
  }

  if (overlay.ports !== undefined) {
    for (const [name, entry] of Object.entries(overlay.ports)) {
      if (entry === undefined) continue;
      const prev = next.ports[name];
      next.ports[name] = {
        hostPort: entry.hostPort ?? prev?.hostPort ?? 0,
        guestPort: entry.guestPort ?? prev?.guestPort ?? entry.hostPort ?? prev?.hostPort ?? 0,
        protocol: (entry.protocol as Protocol | undefined) ?? prev?.protocol ?? "tcp",
        bind: entry.bind ?? prev?.bind ?? "127.0.0.1",
      };
    }
  }

  if (overlay.secrets !== undefined) {
    for (const [name, entry] of Object.entries(overlay.secrets)) {
      if (entry === undefined) continue;
      const prev = next.secrets[name];
      next.secrets[name] = {
        from: entry.from ?? prev?.from ?? "",
        hosts: entry.hosts ?? prev?.hosts ?? [],
      };
    }
  }

  if (overlay.network !== undefined) {
    if (
      overlay.network.defaultEgress === "deny" ||
      overlay.network.defaultEgress === "allow"
    ) {
      next.network.defaultEgress = overlay.network.defaultEgress as EgressPolicy;
    }
    if (overlay.network.inherit === false) {
      // Reset allow to the overlay's list, dropping inherited rules.
      next.network.allow = dedupe(overlay.network.allow ?? []);
      next.network.inherit = false;
    } else if (overlay.network.allow !== undefined) {
      next.network.allow = dedupe([...next.network.allow, ...overlay.network.allow]);
      next.network.inherit = true;
    }
  }

  if (overlay.command !== undefined && overlay.command.argv !== undefined) {
    next.command = { argv: [...overlay.command.argv] };
  }

  return next;
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}
