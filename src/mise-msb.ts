#!/usr/bin/env bun
/**
 * mise-msb — Bun/TypeScript wrapper around the `mise` and `msb` CLIs.
 *
 * Translates layered TOML configuration into inspectable `mise` and `msb`
 * commands. Does not implement sandbox lifecycle itself; delegates every
 * external action to a subprocess.
 */

import { dispatch } from "./commands/dispatch.js";

await dispatch(process.argv.slice(2)).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`mise-msb: ${message}`);
  process.exit(1);
});
