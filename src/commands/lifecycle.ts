/**
 * `start`, `stop`, `remove`, `list` — thin lifecycle delegations.
 */

import { formatArgv } from "../msb/print.js";
import { LifecycleArgv } from "../msb/lifecycle.js";
import type { GlobalOptions } from "./dispatch.js";
import { resolveInvocation } from "./_shared.js";

export async function runStartCommand(
  global: GlobalOptions,
  args: string[],
): Promise<void> {
  const { print } = await resolveInvocation(global, args);
  const name = requireName(args, "start");
  const argv = LifecycleArgv.start(name);
  await runOrPrint(argv, print, "start");
}

export async function runStopCommand(
  global: GlobalOptions,
  args: string[],
): Promise<void> {
  const { print } = await resolveInvocation(global, args);
  const name = requireName(args, "stop");
  const argv = LifecycleArgv.stop(name);
  await runOrPrint(argv, print, "stop");
}

export async function runRemoveCommand(
  global: GlobalOptions,
  args: string[],
): Promise<void> {
  const { print } = await resolveInvocation(global, args);
  const name = requireName(args, "remove");
  const argv = LifecycleArgv.remove(name);
  await runOrPrint(argv, print, "remove");
}

export async function runListCommand(
  global: GlobalOptions,
  args: string[],
): Promise<void> {
  const { print } = await resolveInvocation(global, args);
  void args;
  const argv = LifecycleArgv.list();
  await runOrPrint(argv, print, "list");
}

function requireName(args: string[], cmd: string): string {
  const name = args[0];
  if (name === undefined) {
    throw new Error(`${cmd} requires a sandbox name`);
  }
  return name;
}

async function runOrPrint(argv: string[], print: boolean, label: string): Promise<void> {
  if (print) {
    process.stdout.write(formatArgv(argv) + "\n");
    return;
  }
  const proc = Bun.spawn({
    cmd: argv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`mise-msb ${label}: exited with code ${code}`);
  }
  process.exit(code);
}
