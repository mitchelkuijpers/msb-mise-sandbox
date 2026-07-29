/**
 * `signing init` — generate the dedicated sandbox commit-signing keypair.
 *
 * Creates the wrapper-owned signing directory (0700) and an unencrypted
 * ed25519 keypair (0600 / 0644) with a fixed comment, then prints
 * forge-registration instructions. Never writes to project files.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { GlobalOptions } from "./dispatch.js";
import { SIGNING_KEY_NAME, signingDir } from "../signing/paths.js";

export const SIGNING_KEY_COMMENT = "mise-msb-sandbox-signing";

export interface SigningInitOptions {
  /** Home directory override (used in tests). */
  homeDir?: string;
  /** Output sink (defaults to stdout). */
  out?: (line: string) => void;
}

export interface SigningInitResult {
  status: "created" | "exists" | "regenerated";
  keyPath: string;
  pubPath: string;
}

export async function runSigningCommand(
  _global: GlobalOptions,
  args: string[],
  options: SigningInitOptions = {},
): Promise<SigningInitResult> {
  const sub = args[0];
  if (sub !== "init") {
    throw new Error(
      `usage: mise-msb signing init [--force]\n\n` +
        `Generates the dedicated sandbox commit-signing keypair in ~/.config/mise-msb/signing/.`,
    );
  }
  const force = args.slice(1).includes("--force");
  return signingInit(force, options);
}

export function signingInit(
  force: boolean,
  options: SigningInitOptions = {},
): SigningInitResult {
  const out = options.out ?? ((line: string) => process.stdout.write(line + "\n"));
  const dir = signingDir(options.homeDir);
  const keyPath = join(dir, SIGNING_KEY_NAME);
  const pubPath = `${keyPath}.pub`;

  const existedBefore = existsSync(keyPath);
  if (existedBefore && !force) {
    out(`mise-msb: signing key already exists at ${keyPath}`);
    out(`mise-msb: nothing to do (use --force to regenerate)`);
    return { status: "exists", keyPath, pubPath };
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  // ssh-keygen prompts on overwrite; remove existing files first when
  // regenerating so keygen never blocks on stdin.
  if (existsSync(keyPath)) {
    rmSync(keyPath, { force: true });
    rmSync(pubPath, { force: true });
  }

  const proc = Bun.spawnSync({
    cmd: [
      "ssh-keygen",
      "-t", "ed25519",
      "-N", "",
      "-C", SIGNING_KEY_COMMENT,
      "-f", keyPath,
      "-q",
    ],
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (proc.exitCode !== 0) {
    throw new Error(
      `mise-msb: ssh-keygen failed (${proc.stderr.toString().trim()}); ` +
        `a working ssh-keygen is required for \`signing init\``,
    );
  }
  chmodSync(keyPath, 0o600);
  chmodSync(pubPath, 0o644);

  const publicKey = readFileSync(pubPath, "utf8").trim();
  const status = existedBefore ? "regenerated" : "created";

  out(`mise-msb: ${status === "created" ? "created" : "regenerated"} signing keypair`);
  out(`  private key: ${keyPath}`);
  out(`  public key:  ${pubPath}`);
  out(``);
  out(`Public key:`);
  out(`  ${publicKey}`);
  out(``);
  out(`Register it as an SSH *signing* key with your forge:`);
  out(`  GitHub: https://github.com/settings/ssh/new — set "Key type" to "Signing Key"`);
  out(`  GitLab: Preferences → SSH Keys → "Usage type" = Signing`);
  out(``);
  out(`For commit verification (allowed_signers / .git_allowed_signers), add:`);
  out(`  <your-email> ${publicKey}`);
  if (status === "regenerated") {
    out(``);
    out(`Reminder: remove the OLD key from your forge — it no longer matches this keypair.`);
  }
  out(``);
  out(`Enable signing in ~/.config/mise-msb/config.toml or .sandbox.toml:`);
  out(`  [signing]`);
  out(`  enabled = true`);
  out(`  key = "${keyPath}"`);

  return { status, keyPath, pubPath };
}
