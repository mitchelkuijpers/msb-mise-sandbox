/**
 * Configuration loading and merging facade.
 *
 * Callers should use `loadConfig()` rather than the lower-level loader.
 * This module orchestrates: discovery → parse → validate → merge.
 */

import { dirname } from "node:path";
import { findProjectConfig, loadLayers, type LoadOptions, type LoadedLayer } from "./loader.js";
import { mergeConfigs } from "./merge.js";
import { deriveProjectName } from "./naming.js";
import { validateLayers, validateMerged } from "./validate.js";
import type { PartialConfig, SandboxConfig } from "./types.js";

export interface ResolvedConfig {
  config: SandboxConfig;
  /** Layers that contributed to the merge (low → high precedence). */
  layers: LoadedLayer[];
  /** Absolute path of the discovered project root (or cwd fallback). */
  projectRoot: string;
}

/**
 * Load configuration from disk, validate, merge, and apply identity
 * defaults (project name, image tag, workdir). Throws on validation or
 * parse failure with file/field paths in the message.
 */
export async function loadConfig(options: LoadOptions = {}): Promise<ResolvedConfig> {
  const layers = await loadLayers(options);

  // Validate each layer's raw TOML before merging. This gives file/field
  // diagnostics instead of post-merge confusion.
  validateLayers(layers);

  // Identity defaults: project name from the discovered project root
  // (or the cwd when no .sandbox.toml was found). Computed before the
  // merge so the same-path `project` mount can be derived from it.
  const projectPath = findProjectConfig(options.cwd ?? process.cwd());
  const projectRoot = projectPath !== null ? dirname(projectPath) : options.cwd ?? process.cwd();

  const partials: PartialConfig[] = [];
  for (const layer of layers) {
    if (layer.config !== undefined) {
      partials.push(layer.config);
    }
  }

  // Apply built-in defaults before merging.
  const merged = mergeConfigs(partials, projectRoot);

  const derivedName = deriveProjectName(projectRoot);
  if (merged.identity.name.length === 0) {
    merged.identity.name = derivedName;
  }
  // Image reference is no longer derived from the project name:
  // stock mode uses the versioned stock tag; custom mode requires an explicit reference.

  // Validate the resolved config (e.g. CPU/memory sanity checks).
  validateMerged(merged);

  return { config: merged, layers, projectRoot };
}
