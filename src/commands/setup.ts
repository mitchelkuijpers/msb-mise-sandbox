import { runSetup, type SetupInputs, type SetupOutput } from "../setup/setup.js";
import { STOCK_IMAGE_TAG } from "../stock-image/constants.js";
import type { GlobalOptions } from "./dispatch.js";
import { resolveInvocation } from "./_shared.js";

export async function runSetupCommand(
  global: GlobalOptions,
  args: string[],
): Promise<void> {
  const { print } = await resolveInvocation(global, args, {
    printFlag: args.includes("--print") || args.includes("--dry-run"),
  });
  const force = args.includes("--force");

  const inputs: SetupInputs = {
    printOnly: print,
    force,
  };

  const result: SetupOutput = await runSetup(inputs);

  if (result.exitCode !== 0) {
    if (result.failedStage !== undefined) {
      console.error(`mise-msb setup: "${result.failedStage}" failed`);
    }
    if (result.archivePath !== undefined) {
      console.error(`mise-msb setup: archive preserved at ${result.archivePath}`);
    }
    process.exit(result.exitCode);
  }

  if (result.skipped && !print) {
    console.log(`mise-msb setup: stock image is already loaded (use --force to rebuild)`);
  } else if (!print) {
    console.log(`mise-msb setup: loaded ${STOCK_IMAGE_TAG}`);
  }
}
