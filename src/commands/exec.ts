/**
 * `exec` — Execute a single command inside a running sandbox.
 */

import { formatArgv } from "../msb/print.js";
import { LifecycleArgv } from "../msb/lifecycle.js";
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

  const argv = LifecycleArgv.exec(name, commandArgv);

  if (print) {
    process.stdout.write(formatArgv(argv) + "\n");
    return;
  }

  const proc = Bun.spawn({ cmd: argv, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await proc.exited);
}
