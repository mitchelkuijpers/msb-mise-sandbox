/**
 * `start`, `stop`, `remove`, `list` — thin lifecycle delegations.
 */

import { formatArgv, formatArgvGroups } from "../msb/print.js";
import { LifecycleArgv, planStockBootstrapStages } from "../msb/lifecycle.js";
import type { GlobalOptions } from "./dispatch.js";
import { resolveInvocation } from "./_shared.js";

export async function runStartCommand(
  global: GlobalOptions,
  args: string[],
): Promise<void> {
  const { config, projectRoot, print } = await resolveInvocation(global, args);
  const name = requireName(args, "start");

  const startArgv = LifecycleArgv.start(name);

  if (print) {
    const groups: string[][] = [startArgv];
    if (config.stock.imageMode === "stock") {
      const bootstrap = planStockBootstrapStages({ name, config });
      groups.push(...bootstrap);
    }
    process.stdout.write(formatArgvGroups(groups) + "\n");
    return;
  }

  const proc = Bun.spawn({ cmd: startArgv, stdio: ["inherit", "inherit", "inherit"] });
  const startCode = await proc.exited;
  if (startCode !== 0) {
    process.exit(startCode);
  }

  // Stock mode: run bootstrap after start.
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
  const { config, print } = await resolveInvocation(global, args);
  const name = requireName(args, "remove");
  const argv = LifecycleArgv.remove(name);

  if (print) {
    const groups: string[][] = [argv];
    if (config.stock.imageMode === "stock") {
      const miseVol = `${name}-mise-v1`;
      const dockerVol = `${name}-docker-data`;
      groups.push([
        "echo",
        `mise data volume '${miseVol}' preserved; remove with: msb volume remove ${miseVol}`,
      ]);
      groups.push([
        "echo",
        `docker data volume '${dockerVol}' preserved; remove with: msb volume remove ${dockerVol}`,
      ]);
    }
    process.stdout.write(formatArgvGroups(groups) + "\n");
    return;
  }

  const proc = Bun.spawn({ cmd: argv, stdio: ["inherit", "inherit", "inherit"] });
  const code = await proc.exited;
  if (code !== 0) {
    process.exit(code);
  }

  // Stock mode: print volume preservation info.
  if (config.stock.imageMode === "stock") {
    const miseVol = `${name}-mise-v1`;
    const dockerVol = `${name}-docker-data`;
    console.log(`mise-msb remove: sandbox removed, data volumes preserved`);
    console.log(`  mise data:  ${miseVol}`);
    console.log(`  docker data: ${dockerVol}`);
    console.log(`  To remove them: msb volume remove ${miseVol}`);
    console.log(`  To remove them: msb volume remove ${dockerVol}`);
  }
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
