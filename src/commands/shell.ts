/**
 * `shell` — Attach an interactive shell to a running sandbox.
 */

import { formatArgv, formatArgvGroups } from "../msb/print.js";
import { planStockBootstrapStages } from "../msb/lifecycle.js";
import type { GlobalOptions } from "./dispatch.js";
import { applyNameOverride, resolveInvocation } from "./_shared.js";

export async function runShellCommand(
  global: GlobalOptions,
  args: string[],
): Promise<void> {
  const { config, projectRoot, print } = await resolveInvocation(global, args);
  const name = args[0];
  if (name === undefined) {
    throw new Error("shell requires a sandbox name");
  }
  applyNameOverride(config, name, projectRoot);
  const shellBin = config.env["SHELL"] ?? "/bin/bash";
  const shellArgv = ["msb", "exec", name, "--tty", "--", shellBin];

  if (print) {
    const groups: string[][] = [];
    if (config.stock.imageMode === "stock") {
      const bootstrap = planStockBootstrapStages({ name, config });
      groups.push(...bootstrap);
    }
    groups.push(shellArgv);
    process.stdout.write(formatArgvGroups(groups) + "\n");
    return;
  }

  // Stock mode: ensure bootstrap before shell.
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

  const proc = Bun.spawn({ cmd: shellArgv, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await proc.exited);
}
