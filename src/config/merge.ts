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
  type ImageMode,
  type PartialConfig,
  type Protocol,
  type SandboxConfig,
} from "./types.js";
import { mergeRecord } from "./records.js";
import { homedir } from "node:os";
import { join } from "node:path";

/** Expand a leading `~` (or `~/`) to the user's home directory. */
export function expandHome(path: string, homeDir: string = homedir()): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return join(homeDir, path.slice(2));
  return path;
}

/**
 * Merge an ordered list of partial configs on top of the built-in defaults.
 *
 * When `projectRoot` is provided, the built-in `project` mount's `source: "."`
 * resolves to it, its default target is filled from the resolved source, and
 * the workdir follows the effective target. Both the "." expansion and the
 * same-path `project` mount only apply when `projectRoot` is given.
 */
export function mergeConfigs(layers: PartialConfig[], projectRoot?: string): SandboxConfig {
  let acc: SandboxConfig = cloneDefaults();
  // An explicit top-level `workdir` key in any overlay wins over the workdir
  // derived from the `project` mount (precedence D2).
  let workdirExplicit = false;
  for (const layer of layers) {
    if (layer.workdir !== undefined && layer.workdir.length > 0) {
      workdirExplicit = true;
    }
    acc = mergeLayer(acc, layer, projectRoot);
  }
  // Finalize the built-in `project` mount after all overlays are merged: an
  // explicit overlay target is preserved, anything else falls back to the
  // resolved source. The workdir follows the effective target.
  const project = acc.mounts["project"];
  if (projectRoot !== undefined && project !== undefined) {
    const source = project.source === "." ? projectRoot : project.source;
    const target = project.target.length > 0 ? project.target : source;
    acc.mounts["project"] = { ...project, source, target };
    if (!workdirExplicit) {
      acc.workdirTarget = target;
      acc.identity.workdir = target;
    }
  }
  return acc;
}

function cloneDefaults(): SandboxConfig {
  return {
    identity: { ...BUILTIN_DEFAULTS.identity },
    stock: { ...BUILTIN_DEFAULTS.stock },
    runtime: { ...BUILTIN_DEFAULTS.runtime },
    workdirTarget: BUILTIN_DEFAULTS.workdirTarget,
    mounts: { ...BUILTIN_DEFAULTS.mounts },
    ports: {},
    network: {
      defaultEgress: BUILTIN_DEFAULTS.network.defaultEgress,
      allow: [],
      inherit: BUILTIN_DEFAULTS.network.inherit,
    },
    env: {},
    secrets: {},
    labels: {},
    signing: { ...BUILTIN_DEFAULTS.signing },
  };
}

function mergeLayer(
  base: SandboxConfig,
  overlay: PartialConfig,
  projectRoot?: string,
): SandboxConfig {
  const next: SandboxConfig = {
    identity: { ...base.identity },
    stock: { ...base.stock },
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
    signing: { ...base.signing },
  };

  if (overlay.identity !== undefined) {
    if (overlay.identity.name !== undefined) {
      next.identity.name = overlay.identity.name;
    }
    if (overlay.identity.workdir !== undefined) {
      next.identity.workdir = overlay.identity.workdir;
    }
  }

  if (overlay.stock !== undefined) {
    if (overlay.stock.imageMode !== undefined) {
      next.stock.imageMode = overlay.stock.imageMode as ImageMode;
    }
    if (overlay.stock.customImage !== undefined && overlay.stock.customImage.length > 0) {
      next.stock.customImage = overlay.stock.customImage;
    }
    if (overlay.stock.dockerDataSize !== undefined && overlay.stock.dockerDataSize.length > 0) {
      next.stock.dockerDataSize = overlay.stock.dockerDataSize as `${number}${"M" | "G"}`;
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
      let source = entry.source ?? prev?.source ?? "";
      // "." is the only magic source value: it resolves to the project
      // root at merge time so config display and validation see absolute
      // paths. Other relative sources stay verbatim.
      if (source === "." && projectRoot !== undefined) {
        source = projectRoot;
      }
      // The built-in `project` mount targets the resolved source by
      // default; an explicit overlay target overrides it via the
      // named-table merge.
      const target = entry.target ?? prev?.target ?? (name === "project" ? source : "");
      next.mounts[name] = {
        kind: entry.kind ?? prev?.kind ?? "dir",
        source,
        target,
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

  if (overlay.signing !== undefined) {
    if (overlay.signing.enabled !== undefined) {
      next.signing.enabled = overlay.signing.enabled;
    }
    if (overlay.signing.key !== undefined && overlay.signing.key.length > 0) {
      next.signing.key = expandHome(overlay.signing.key);
    }
  }

  return next;
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}
