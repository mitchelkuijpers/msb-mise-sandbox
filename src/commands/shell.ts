/**
 * `agent-sandbox shell <project>` — open an interactive shell.
 */

import { shellInSandbox } from "../lib/sandbox.js";

export async function shellCommand(project: string): Promise<void> {
  console.log(`Opening shell in sandbox "${project}"…`);
  const code = await shellInSandbox(project);
  if (code !== 0) {
    console.error(`Shell exited with code ${code}`);
  }
}
