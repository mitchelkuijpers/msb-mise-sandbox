/**
 * `agent-sandbox project remove <name>` — remove a project from the registry.
 */

import { removeProject } from "../lib/config.js";

export async function projectRemoveCommand(name: string): Promise<void> {
  removeProject(name);
  console.log(`✅ Project "${name}" removed from registry.`);
}
