/**
 * `agent-sandbox remove <project>` — remove a stopped sandbox.
 *
 * The Docker data volume (<project>-docker-data) is intentionally NOT
 * removed: it persists across sandbox removal so pulled images and build
 * cache survive re-creation. When the project had Docker enabled and the
 * volume is still around, print its name and the cleanup command.
 */

import { removeSandbox, listVolumes } from "../lib/sandbox.js";
import { loadProject } from "../lib/config.js";

export async function removeCommand(project: string): Promise<void> {
  try {
    await removeSandbox(project);
    console.log(`✅ Sandbox "${project}" removed.`);
  } catch {
    console.error(`Sandbox "${project}" does not exist.`);
    process.exit(1);
  }

  // Docker data volume persists — tell the user how to reclaim it.
  try {
    const config = loadProject(project);
    if (config.docker?.enabled) {
      const volumeName = `${project}-docker-data`;
      const volumes = await listVolumes();
      if (volumes.includes(volumeName)) {
        console.log(
          `ℹ️  Docker data volume "${volumeName}" was preserved ` +
            "(holds pulled images and build cache).",
        );
        console.log(`    To delete it: msb volume rm ${volumeName}`);
      }
    }
  } catch {
    // Project no longer in the registry (or config unreadable) — there's
    // nothing to look up, so skip the volume note silently.
  }
}
