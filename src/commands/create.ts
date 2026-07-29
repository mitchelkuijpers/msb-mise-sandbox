/**
 * `create` — Create a sandbox from the merged config.
 */

import { formatArgv, formatArgvGroups } from "../msb/print.js";
import { LifecycleArgv, planStockBootstrapStages, stockImageIsLoaded } from "../msb/lifecycle.js";
import { STOCK_IMAGE_TAG } from "../stock-image/constants.js";
import type { GlobalOptions } from "./dispatch.js";
import { applyNameOverride, gateSigningValidation, resolveInvocation } from "./_shared.js";
import { resolveImage } from "../config/naming.js";
import { hostGitIdentity } from "../signing/gitconfig.js";

export async function runCreateCommand(
  global: GlobalOptions,
  args: string[],
): Promise<void> {
  const { config, projectRoot, print } = await resolveInvocation(global, args);
  const name = args[0];
  if (name === undefined) {
    throw new Error("create requires a sandbox name");
  }
  applyNameOverride(config, name, projectRoot);

  // Signing preflight: fail closed before any msb invocation (print too).
  const validatedKey = gateSigningValidation(config);

  // Stock mode preflight: ensure the stock image is loaded.
  if (config.stock.imageMode === "stock" && !print) {
    if (!stockImageIsLoaded()) {
      console.error(
        `mise-msb create: stock image ${STOCK_IMAGE_TAG} is not loaded.\n` +
        `Run: mise-msb setup`,
      );
      process.exit(1);
    }
  }

  const createArgv = LifecycleArgv.create({
    image: resolveImage(config),
    name,
    config,
    signingKey: validatedKey,
    gitIdentity: config.signing.enabled ? hostGitIdentity() : undefined,
  });

  if (print) {
    const groups: string[][] = [createArgv];
    if (config.stock.imageMode === "stock") {
      const bootstrap = planStockBootstrapStages({ name, config });
      groups.push(...bootstrap);
    }
    process.stdout.write(formatArgvGroups(groups) + "\n");
    return;
  }

  const proc = Bun.spawn({ cmd: createArgv, stdio: ["inherit", "inherit", "inherit"] });
  const createCode = await proc.exited;
  if (createCode !== 0) {
    process.exit(createCode);
  }

  // Stock mode: run bootstrap stages after creation.
  if (config.stock.imageMode === "stock") {
    const bootstrap = planStockBootstrapStages({ name, config });
    for (const argv of bootstrap) {
      const bproc = Bun.spawn({ cmd: argv, stdio: ["inherit", "inherit", "inherit"] });
      const code = await bproc.exited;
      if (code !== 0) {
        process.exit(code);
      }
    }
  }
}
