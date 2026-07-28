/**
 * TOML loading and project discovery.
 *
 * Layer order (lowest → highest precedence):
 *   1. Built-in defaults
 *   2. Personal defaults at $XDG_CONFIG_HOME/mise-msb/config.toml
 *      (or ~/.config/mise-msb/config.toml)
 *   3. Project config at <project-root>/.sandbox.toml (walked up from cwd)
 *   4. Explicit --config <path> override (skips discovery)
 *
 * Discovery is silent on missing optional files; existing files with
 * invalid TOML fail loudly before any external command runs.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { PartialConfig } from "./types.js";

export interface LoadedLayer {
  /** Source identifier — file path or "<builtin>". */
  source: string;
  /** Parsed config (undefined when the file does not exist). */
  config?: PartialConfig;
}

export interface LoadOptions {
  /** Optional explicit config path (skips discovery). */
  configPath?: string;
  /** Optional override for the start directory (default: process.cwd()). */
  cwd?: string;
  /** Optional override for $HOME (used in tests). */
  homeDir?: string;
}

/** Return the user's personal defaults path. */
export function personalConfigPath(homeDir: string = homedir()): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg && xdg.length > 0) {
    return join(xdg, "mise-msb", "config.toml");
  }
  return join(homeDir, ".config", "mise-msb", "config.toml");
}

/**
 * Return the user's personal image directory — the fixed Docker build
 * context and home of the optional personal `Containerfile`. Resolves the
 * same way as {@link personalConfigPath} so both stay under one config root.
 */
export function personalImageDirPath(homeDir: string = homedir()): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg && xdg.length > 0) {
    return join(xdg, "mise-msb", "image");
  }
  return join(homeDir, ".config", "mise-msb", "image");
}

/**
 * Walk up from `start` looking for `.sandbox.toml`.
 * Returns the resolved path, or null if none is found.
 */
export function findProjectConfig(start: string): string | null {
  let dir = resolve(start);
  const root = "/";
  while (true) {
    const candidate = join(dir, ".sandbox.toml");
    if (existsSync(candidate)) {
      return candidate;
    }
    if (dir === root) {
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/** Parse TOML text into a PartialConfig (or throw). */
export function parseToml(text: string, source: string): PartialConfig {
  // Bun.TOML.parse returns a JSON-ish tree; every nested table is an object.
  // We use a wrapper to surface a useful error message on failure.
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse ${source}: ${msg}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source}: top-level must be a table`);
  }
  return parsed as PartialConfig;
}

/**
 * Load configuration layers in precedence order.
 *
 * Returned layers are ordered low → high precedence. Merging is the
 * caller's responsibility (see merge.ts).
 *
 * The explicit `--config` flag always wins and disables discovery.
 */
export async function loadLayers(
  options: LoadOptions = {},
): Promise<LoadedLayer[]> {
  const layers: LoadedLayer[] = [];
  const homeDir = options.homeDir ?? homedir();
  const cwd = options.cwd ?? process.cwd();

  // Layer 2: personal defaults (optional).
  const personal = personalConfigPath(homeDir);
  layers.push(await loadFile(personal));

  // Layer 3 (or 3+4): project discovery unless explicit override.
  if (options.configPath !== undefined) {
    const explicit = resolve(options.configPath);
    if (!isAbsolute(explicit)) {
      throw new Error(`--config path must be absolute: ${options.configPath}`);
    }
    layers.push(await loadFile(explicit));
  } else {
    const projectPath = findProjectConfig(cwd);
    if (projectPath !== null) {
      layers.push(await loadFile(projectPath));
    }
  }

  return layers;
}

async function loadFile(path: string): Promise<LoadedLayer> {
  if (!existsSync(path)) {
    return { source: path, config: undefined };
  }
  const text = await readFile(path, "utf8");
  const config = parseToml(text, path);
  return { source: path, config };
}
