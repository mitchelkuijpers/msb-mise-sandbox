/**
 * `agent-sandbox opencode <project>` — launch OpenCode inside the sandbox.
 */

import { attachInSandbox } from "../lib/sandbox.js";

export async function opencodeCommand(project: string): Promise<void> {
  console.log(`Launching OpenCode in sandbox "${project}"…`);
  const code = await attachInSandbox(project, "opencode");
  if (code !== 0) {
    console.error(`OpenCode exited with code ${code}`);
    process.exitCode = code;
  }
}
