/**
 * `ssh-proxy` / `ssh-config` — Remote SSH transport adapters.
 *
 * `ssh-proxy` adapts a `.msb` SSH alias to the raw msb stdio transport so
 * OpenSSH's ProxyCommand can reach a sandbox without a lifecycle command.
 * It is transport-only: it validates the alias, spawns `msb ssh serve` and
 * propagates its exit code, never touching stdout or the filesystem itself.
 * `ssh-config` renders the reusable OpenSSH Host block verbatim.
 */

const ALIAS_SUFFIX = ".msb";

/** Lowercase DNS-ish sandbox name, mirroring microsandbox naming rules. */
const SANDBOX_NAME_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

export async function runSshProxyCommand(args: string[]): Promise<void> {
  if (args.length !== 1) {
    const got = args.length === 0 ? "no alias" : `${args.length} args: ${args.join(" ")}`;
    throw new Error(`ssh-proxy requires exactly one <name>.msb alias (got: ${got})`);
  }
  const alias = args[0]!;
  if (!alias.endsWith(ALIAS_SUFFIX)) {
    throw new Error(
      `ssh-proxy requires exactly one <name>.msb alias (got: ${alias} — alias must end in .msb)`,
    );
  }
  const name = alias.slice(0, -ALIAS_SUFFIX.length);
  if (name.length === 0) {
    throw new Error(
      `ssh-proxy requires exactly one <name>.msb alias (got: ${alias} — name before .msb is empty)`,
    );
  }
  if (!SANDBOX_NAME_RE.test(name)) {
    throw new Error(
      `ssh-proxy requires exactly one <name>.msb alias (got: ${alias} — ${name} is not a valid sandbox name; use lowercase letters, digits, dots, underscores, and hyphens)`,
    );
  }
  const proc = Bun.spawn({
    cmd: ["msb", "ssh", "serve", name, "--stdio"],
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  process.exit(code);
}

export async function runSshConfigCommand(args: string[]): Promise<void> {
  if (args.length > 0) {
    throw new Error(
      `ssh-config takes no arguments (got: ${args.join(" ")}); run \`mise-msb ssh-config\` and add the printed block to ~/.ssh/config`,
    );
  }
  process.stdout.write(
    "Host *.msb\n" +
      "    User root\n" +
      "    ProxyCommand mise-msb ssh-proxy %n\n" +
      "    StrictHostKeyChecking no\n" +
      "    UserKnownHostsFile /dev/null\n",
  );
}
