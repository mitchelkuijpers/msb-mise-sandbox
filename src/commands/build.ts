/**
 * `agent-sandbox build` — build the custom OCI image and load it into
 * microsandbox.
 *
 * 1. `docker build -t agent-sandbox:latest -f Containerfile .`
 * 2. `docker save agent-sandbox:latest | msb image load --tag agent-sandbox:latest`
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";

/** Resolve the project root (where Containerfile lives). */
function projectRoot(): string {
  // This file is at src/commands/build.ts → two levels up is the root.
  return resolve(import.meta.dirname ?? __dirname, "..", "..");
}

export async function buildImage(): Promise<void> {
  const root = projectRoot();

  console.log("🔨 Building agent-sandbox:latest from Containerfile…");
  execSync(`docker build --load -t agent-sandbox:latest -f Containerfile .`, {
    cwd: root,
    stdio: "inherit",
  });

  console.log("📦 Loading image into microsandbox…");
  // `msb image load` reads a tar archive from stdin (`--input <PATH>` also
  // supported).  We pipe `docker save` so msb receives the OCI layers and
  // tags the result with --tag.
  execSync(
    "docker save agent-sandbox:latest | msb image load --tag agent-sandbox:latest",
    {
      cwd: root,
      stdio: "inherit",
      shell: "/bin/sh",
    },
  );

  console.log("✅ Build complete — agent-sandbox:latest loaded.");
}
