/**
 * `agent-sandbox stop <project>` — stop a running sandbox.
 */

import { stopSandbox } from "../lib/sandbox.js";

export async function stopCommand(project: string): Promise<void> {
  console.log(`Stopping sandbox "${project}"…`);
  try {
    await stopSandbox(project);
    console.log(`✅ Sandbox "${project}" stopped.`);
  } catch {
    console.error(`Sandbox "${project}" is not running or does not exist.`);
    process.exit(1);
  }
}
