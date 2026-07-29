import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { SandboxConfig } from "../config/types.js";
import {
  PERSONAL_GLOBAL_CONFIG_ENV,
  PERSONAL_MOUNT_TARGET,
} from "../stock-image/constants.js";

export const BOOTSTRAP_RELATIVE = join(".config", "mise-msb", "bootstrap");

export function personalBootstrapDir(homeDir: string = homedir()): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg && xdg.length > 0 ? xdg : join(homeDir, ".config");
  return join(base, "mise-msb", "bootstrap");
}

export interface PersonalBootstrapConfig {
  dir: string;
  miseTomlPath: string;
}

export const PERSONAL_BOOTSTRAP_MOUNT_NAME = "mise-msb-personal-bootstrap";

export function discoverPersonalBootstrap(homeDir?: string): PersonalBootstrapConfig | null {
  const dir = personalBootstrapDir(homeDir);
  const miseTomlPath = join(dir, "mise.toml");
  if (!existsSync(miseTomlPath)) {
    return null;
  }
  return { dir, miseTomlPath };
}

export function configurePersonalBootstrap(
  config: SandboxConfig,
  homeDir?: string,
): PersonalBootstrapConfig | null {
  if (config.stock.imageMode !== "stock") return null;

  const personal = discoverPersonalBootstrap(homeDir);
  if (personal === null) return null;

  const source = realpathSync(personal.dir);
  config.mounts[PERSONAL_BOOTSTRAP_MOUNT_NAME] = {
    kind: "dir",
    source,
    target: PERSONAL_MOUNT_TARGET,
  };
  config.env[PERSONAL_GLOBAL_CONFIG_ENV] = `${PERSONAL_MOUNT_TARGET}/mise.toml`;
  return personal;
}

export function hashBootstrapDir(dir: string): string {
  const hash = createHash("sha256");
  const entries = collectEntries(dir);
  for (const entry of entries.sort()) {
    const fullPath = join(dir, entry);
    hash.update(entry.replace(/\\/g, "/"));
    try {
      const content = readFileSync(fullPath);
      hash.update(content);
    } catch {
      hash.update("__unreadable__");
    }
  }
  return hash.digest("hex");
}

function collectEntries(dir: string): string[] {
  const entries: string[] = [];
  if (!existsSync(dir)) return entries;
  try {
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let names: string[];
      try {
        names = readdirSync(current);
      } catch {
        continue;
      }
      for (const name of names.sort()) {
        const fullPath = join(current, name);
        let st: ReturnType<typeof statSync>;
        try {
          st = statSync(fullPath);
        } catch {
          continue;
        }
        const rel = relative(dir, fullPath);
        if (st.isDirectory()) {
          stack.push(fullPath);
          entries.push(rel + "/");
        } else {
          entries.push(rel);
        }
      }
    }
  } catch {
  }
  return entries;
}
