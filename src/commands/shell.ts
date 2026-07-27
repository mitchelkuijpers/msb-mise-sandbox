/**
 * `shell` — Attach an interactive shell to a running sandbox.
 */

import { formatArgv } from "../msb/print.js";
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
  const argv = ["msb", "exec", name, "--tty", "--", shellBin];

  if (print) {
    process.stdout.write(formatArgv(argv) + "\n");
    return;
  }

  const proc = Bun.spawn({ cmd: argv, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await proc.exited);
}
