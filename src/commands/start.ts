/**
 * `agent-sandbox start <project>` — resume a stopped sandbox.
 */

import { startSandbox } from "../lib/sandbox.js";

export async function startCommand(project: string): Promise<void> {
  console.log(`Starting sandbox "${project}"…`);
  try {
    await startSandbox(project);
    console.log(`✅ Sandbox "${project}" started.`);
  } catch {
    console.error(`Sandbox "${project}" does not exist or is already running.`);
    process.exit(1);
  }
}
