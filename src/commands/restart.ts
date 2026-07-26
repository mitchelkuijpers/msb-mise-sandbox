/**
 * `agent-sandbox restart <project>` — stop then start a sandbox.
 */

import { Sandbox } from "microsandbox";

export async function restartCommand(project: string): Promise<void> {
  const handle = await Sandbox.get(project);

  const wasRunning = handle.status === "running";

  if (wasRunning) {
    console.log(`Stopping sandbox "${project}"…`);
    await handle.stop();
    await handle.waitUntilStopped();
  } else {
    console.log(`Sandbox "${project}" is ${handle.status}; starting directly…`);
  }

  console.log(`Starting sandbox "${project}"…`);
  await Sandbox.startDetached(project);
  console.log(`✅ Sandbox "${project}" restarted.`);
}
