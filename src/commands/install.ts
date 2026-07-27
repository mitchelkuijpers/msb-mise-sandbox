/**
 * `install` — Idempotent symlink install into ~/.local/bin.
 */

import { defaultBinDir, installWrapper, pathContains, pathWarningMessage } from "../install/symlink.js";
import { homedir } from "node:os";
import type { GlobalOptions } from "./dispatch.js";

export async function runInstallCommand(
  _global: GlobalOptions,
  args: string[],
): Promise<void> {
  void _global;
  const force = args.includes("--force");
  const result = installWrapper({ force });
  const binDir = defaultBinDir();

  switch (result.status) {
    case "created":
      console.log(`mise-msb: installed ${result.destination} -> ${result.target}`);
      break;
    case "replaced":
      console.log(`mise-msb: replaced ${result.destination} -> ${result.target}`);
      break;
    case "unchanged":
      console.log(`mise-msb: ${result.destination} already points at ${result.target}`);
      break;
    case "refused":
      console.error(
        `mise-msb: ${result.destination} already exists and points at ${result.existingTarget ?? "(unknown)"}.\n` +
          `Use --force to replace it.`,
      );
      process.exit(1);
      return;
  }

  if (!pathContains(binDir)) {
    console.error(pathWarningMessage(binDir));
  }
  void homedir;
}
