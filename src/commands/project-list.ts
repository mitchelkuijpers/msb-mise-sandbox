/**
 * `agent-sandbox project list` — list all registered projects.
 */

import { loadRegistry } from "../lib/config.js";
import type { ProjectConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

export interface ProjectRow {
  name: string;
  gitlabUrl: string;
  secretEnvNames: string[];
}

/**
 * Build display rows from the registry.
 */
export function buildProjectRows(
  projects: Record<string, ProjectConfig>,
): ProjectRow[] {
  return Object.entries(projects).map(([name, cfg]) => ({
    name,
    gitlabUrl: cfg.gitlab.url,
    secretEnvNames: (cfg.secrets ?? []).map((s) => s.env),
  }));
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function projectListCommand(): Promise<void> {
  const registry = loadRegistry();
  const rows = buildProjectRows(registry.projects);

  if (rows.length === 0) {
    console.log("No projects registered.");
    return;
  }

  for (const row of rows) {
    const secrets =
      row.secretEnvNames.length > 0
        ? row.secretEnvNames.join(", ")
        : "(none)";
    console.log(`${row.name}:`);
    console.log(`  GitLab URL: ${row.gitlabUrl}`);
    console.log(`  Secrets:    ${secrets}`);
    console.log();
  }
}
