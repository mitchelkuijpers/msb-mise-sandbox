/**
 * Fixed paths for sandbox commit signing.
 *
 * Host side: the wrapper-owned signing directory is
 * `$XDG_CONFIG_HOME/mise-msb/signing/` (or `~/.config/mise-msb/signing/`).
 * Guest side: key material is mounted at fixed targets outside `~/.ssh`
 * and the generated gitconfig owns the guest's global git slot.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** Host-side key filename (private key; `.pub` is its sibling). */
export const SIGNING_KEY_NAME = "id_ed25519_sandbox";

/** Guest directory holding the mounted signing keypair. */
export const GUEST_SIGNING_DIR = "/etc/mise-msb/signing";

/** Fixed guest targets for the mounted keypair. */
export const GUEST_KEY_PATH = `${GUEST_SIGNING_DIR}/${SIGNING_KEY_NAME}`;
export const GUEST_PUBKEY_PATH = `${GUEST_KEY_PATH}.pub`;

/** Guest path of the wrapper-generated gitconfig. */
export const GUEST_GITCONFIG_PATH = "/etc/mise-msb/gitconfig";

/** Neutral guest target for a mounted host gitconfig (included by the generated gitconfig). */
export const GUEST_HOST_GITCONFIG_PATH = "/etc/mise-msb/host-gitconfig";

/** Environment variable that pins the guest's global gitconfig. */
export const GIT_CONFIG_GLOBAL_ENV = "GIT_CONFIG_GLOBAL";

/** Wrapper-owned host signing directory (honors XDG config home). */
export function signingDir(homeDir: string = homedir()): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg && xdg.length > 0 ? xdg : join(homeDir, ".config");
  return join(base, "mise-msb", "signing");
}

/** Default host path of the signing private key. */
export function defaultKeyPath(homeDir?: string): string {
  return join(signingDir(homeDir), SIGNING_KEY_NAME);
}
