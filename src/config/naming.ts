/**
 * Project identity normalization.
 *
 * The sandbox name defaults to the discovered project root's
 * basename, lowercased and stripped of characters that aren't safe for
 * the msb CLI. Image references are no longer derived from project
 * identity: stock mode uses the versioned stock tag; custom mode
 * requires an explicit reference.
 */

import { basename } from "node:path";

const UNSAFE = /[^a-z0-9._-]+/g;

export function deriveProjectName(projectRoot: string): string {
  const base = basename(projectRoot);
  const normalized = base.toLowerCase().replace(UNSAFE, "-");
  // Names cannot start with a separator.
  return normalized.replace(/^[-.]+|[-.]+$/g, "") || "sandbox";
}

/**
 * Resolve the effective image reference for a sandbox.
 * Stock mode returns the versioned stock tag; custom mode returns
 * the explicit reference or throws if missing.
 */
import { STOCK_IMAGE_TAG } from "../stock-image/constants.js";
import type { SandboxConfig } from "./types.js";

export function resolveImage(config: SandboxConfig): string {
  if (config.stock.imageMode === "custom") {
    if (config.stock.customImage === undefined || config.stock.customImage.length === 0) {
      throw new Error("stock.customImage is required when imageMode is 'custom'");
    }
    return config.stock.customImage;
  }
  return STOCK_IMAGE_TAG;
}
