/**
 * `agent-sandbox codex <project>` — launch Codex inside the sandbox.
 */

import { attachInSandbox } from "../lib/sandbox.js";

export async function codexCommand(project: string): Promise<void> {
  console.log(`Launching Codex in sandbox "${project}"…`);
  const code = await attachInSandbox(project, "codex");
  if (code !== 0) {
    console.error(`Codex exited with code ${code}`);
    process.exitCode = code;
  }
}
