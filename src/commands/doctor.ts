/**
 * `agent-sandbox doctor` — run health checks on the sandbox setup.
 */

import { execFileSync } from "node:child_process";
import { loadRegistry } from "../lib/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MSB_COMMAND = "msb";

// ---------------------------------------------------------------------------
// Check runner
// ---------------------------------------------------------------------------

export interface CheckResult {
  label: string;
  passed: boolean;
  error?: string;
}

/**
 * Run a list of checks and return results.
 * Exported for testing.
 */
export async function runChecks(
  checks: Array<{ label: string; run: () => void | Promise<void> }>,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      await check.run();
      results.push({ label: check.label, passed: true });
    } catch (err) {
      results.push({
        label: check.label,
        passed: false,
        error: (err as Error).message,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * Print a pass/fail line for each check.
 * Returns `true` if all passed.
 */
export function printResults(results: CheckResult[]): boolean {
  let allPassed = true;
  for (const r of results) {
    if (r.passed) {
      console.log(`  ✓ ${r.label}`);
    } else {
      console.log(`  ✗ ${r.label}${r.error ? `: ${r.error}` : ""}`);
      allPassed = false;
    }
  }
  return allPassed;
}

export async function doctorCommand(): Promise<void> {
  console.log("Running agent-sandbox diagnostics…\n");

  const results = await runChecks([
    {
      label: "msb CLI installed",
      run: () => {
        execFileSync(MSB_COMMAND, ["--version"], {
          timeout: 15_000,
          stdio: "pipe",
        });
      },
    },
    {
      label: "msb doctor passes",
      run: () => {
        execFileSync(MSB_COMMAND, ["doctor"], {
          timeout: 30_000,
          stdio: "pipe",
        });
      },
    },
    {
      label: "agent-sandbox:latest image cached",
      run: () => {
        const stdout = execFileSync(MSB_COMMAND, ["image", "list", "--format", "json"], {
          timeout: 15_000,
          encoding: "utf-8",
        });
        const images: unknown = JSON.parse(stdout);
        const found = (Array.isArray(images) ? images : []).some(
          (img: any) =>
            img.reference === "agent-sandbox:latest" ||
            img.reference === "docker.io/library/agent-sandbox:latest" ||
            img.name === "agent-sandbox:latest" ||
            (Array.isArray(img.tags) && img.tags.includes("agent-sandbox:latest")),
        );
        if (!found)
          throw new Error(
            "agent-sandbox:latest not found — run `agent-sandbox build`",
          );
      },
    },
    {
      label: "projects.json is valid",
      run: () => {
        loadRegistry();
      },
    },
  ]);

  console.log("");
  const ok = printResults(results);
  if (ok) {
    console.log("All checks passed.");
  } else {
    console.error("Some checks failed.");
    process.exit(1);
  }
}
