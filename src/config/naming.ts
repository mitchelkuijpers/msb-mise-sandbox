/**
 * Project identity normalization.
 *
 * The sandbox name and image tag default to the discovered project root's
 * basename, lowercased and stripped of characters that aren't safe for
 * the msb CLI or container tags.
 */

import { basename } from "node:path";

const UNSAFE = /[^a-z0-9._-]+/g;

export function deriveProjectName(projectRoot: string): string {
  const base = basename(projectRoot);
  const normalized = base.toLowerCase().replace(UNSAFE, "-");
  // Tags cannot start with a separator.
  return normalized.replace(/^[-.]+|[-.]+$/g, "") || "sandbox";
}

/**
 * Build the default image tag from a project name.
 * The design specifies `<project-name>:dev` as the default tag.
 */
export function deriveDefaultTag(projectName: string): string {
  return `${projectName}:dev`;
}
