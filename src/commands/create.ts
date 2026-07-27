/**
 * `create` — Create a sandbox from the merged config.
 */

import { formatArgv } from "../msb/print.js";
import { LifecycleArgv } from "../msb/lifecycle.js";
import type { GlobalOptions } from "./dispatch.js";
import { applyNameOverride, resolveInvocation } from "./_shared.js";

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

  const argv = LifecycleArgv.create({
    image: config.build.tag,
    name,
    config,
  });

  if (print) {
    process.stdout.write(formatArgv(argv) + "\n");
    return;
  }

  const proc = Bun.spawn({ cmd: argv, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await proc.exited);
}
