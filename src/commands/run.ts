/**
 * `run` — Create or start the sandbox, then exec the configured command.
 */

import { formatArgvGroups } from "../msb/print.js";
import { planRunSequence } from "../msb/lifecycle.js";
import type { GlobalOptions } from "./dispatch.js";
import { applyNameOverride, resolveInvocation } from "./_shared.js";

export async function runRunCommand(
  global: GlobalOptions,
  args: string[],
): Promise<void> {
  const { config, projectRoot, print } = await resolveInvocation(global, args);
  const { name, commandArgv } = splitNameAndCommand(args);
  if (name === undefined) {
    throw new Error("run requires a sandbox name");
  }
  applyNameOverride(config, name, projectRoot);

  const sequence = planRunSequence({
    config,
    image: config.build.tag,
    name,
    commandArgv,
  });

  if (print) {
    process.stdout.write(formatArgvGroups(sequence.groups) + "\n");
    return;
  }

  for (const argv of sequence.groups) {
    const proc = Bun.spawn({ cmd: argv, stdio: ["inherit", "inherit", "inherit"] });
    const code = await proc.exited;
    if (code !== 0) {
      process.exit(code);
    }
  }
}

function splitNameAndCommand(args: string[]): { name: string | undefined; commandArgv?: string[] } {
  const sep = args.indexOf("--");
  if (sep === -1) {
    return { name: args[0] };
  }
  const name = args[0];
  const commandArgv = args.slice(sep + 1);
  return { name, commandArgv: commandArgv.length > 0 ? commandArgv : undefined };
}
