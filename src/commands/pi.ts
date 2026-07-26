/**
 * `agent-sandbox pi <project>` — launch Pi inside the sandbox.
 */

import { attachInSandbox } from "../lib/sandbox.js";

export async function piCommand(project: string): Promise<void> {
  console.log(`Launching Pi in sandbox "${project}"…`);
  const code = await attachInSandbox(project, "pi");
  if (code !== 0) {
    console.error(`Pi exited with code ${code}`);
    process.exitCode = code;
  }
}
