/**
 * `agent-sandbox create <project>` — create a sandbox from a registered
 * project config.
 */

import { Sandbox } from "microsandbox";
import { loadProject } from "../lib/config.js";
import { createSandbox, listSandboxes, startSandbox } from "../lib/sandbox.js";

export async function createCommand(project: string): Promise<void> {
  // Check if a sandbox with this name already exists.
  try {
    await Sandbox.get(project);
    console.error(`A sandbox named "${project}" already exists.`);
    console.error("Use `agent-sandbox start` or `agent-sandbox remove` first.");
    process.exit(1);
  } catch {
    // Not found — expected. Proceed.
  }

  const config = loadProject(project);

  console.log(`Creating sandbox "${project}"…`);
  const sandbox = await createSandbox(project, config);
  const entry = (await listSandboxes()).find((item) => item.name === project);
  if (!entry || entry.status.toLowerCase() !== "running") {
    await startSandbox(project);
  }

  console.log(`✅ Sandbox "${sandbox.name}" created and started.`);
}
