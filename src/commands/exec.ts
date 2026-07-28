/**
 * `exec` — Execute a single command inside a running sandbox.
 */

import { formatArgv, formatArgvGroups } from "../msb/print.js";
import { LifecycleArgv, planStockBootstrapStages } from "../msb/lifecycle.js";
import type { GlobalOptions } from "./dispatch.js";
import { applyNameOverride, resolveInvocation } from "./_shared.js";

export async function runExecCommand(
  global: GlobalOptions,
  args: string[],
): Promise<void> {
  const { config, projectRoot, print } = await resolveInvocation(global, args);
  const sep = args.indexOf("--");
  if (sep === -1) {
    throw new Error("exec requires a `--` separator before the command");
  }
  const name = args[0];
  const commandArgv = args.slice(sep + 1);
  if (name === undefined) {
    throw new Error("exec requires a sandbox name before `--`");
  }
  if (commandArgv.length === 0) {
    throw new Error("exec requires a command after `--`");
  }
  applyNameOverride(config, name, projectRoot);

  if (print) {
    const groups: string[][] = [];
    if (config.stock.imageMode === "stock") {
      const bootstrap = planStockBootstrapStages({ name, config });
      groups.push(...bootstrap);
    }
    groups.push(LifecycleArgv.exec(name, commandArgv));
    process.stdout.write(formatArgvGroups(groups) + "\n");
    return;
  }

  // Stock mode: ensure bootstrap before exec.
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

  const argv = LifecycleArgv.exec(name, commandArgv);
  const proc = Bun.spawn({ cmd: argv, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await proc.exited);
}
