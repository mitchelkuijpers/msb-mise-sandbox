/**
 * `agent-sandbox project add <name>` — interactively add a project
 * to the registry.
 */

import * as readline from "node:readline/promises";
import * as fs from "node:fs";
import { stdin, stdout } from "node:process";
import { addProject } from "../lib/config.js";
import type { ProjectConfig, SecretEntry } from "../types.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Build a ProjectConfig from prompted values.
 * Exported for testing.
 */
export function buildProjectConfig(
  url: string,
  tokenEnvVar: string,
  secrets: SecretEntry[],
  dockerEnabled: boolean = false,
): ProjectConfig {
  const allowHost = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "gitlab.com";
    }
  })();

  const config: ProjectConfig = {
    gitlab: { url, tokenRef: `env:${tokenEnvVar}` },
    secrets: [
      {
        env: tokenEnvVar,
        from: `env:${tokenEnvVar}`,
        allow: allowHost,
      },
      ...secrets,
    ],
  };

  if (dockerEnabled) {
    config.docker = { enabled: true, dataVolumeSize: "10G" };
  }

  return config;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function projectAddCommand(name: string): Promise<void> {
  const scriptedAnswers = stdin.isTTY
    ? null
    : fs.readFileSync(0, "utf8").split(/\r?\n/);
  const rl = scriptedAnswers
    ? null
    : readline.createInterface({ input: stdin, output: stdout });

  const ask = async (prompt: string): Promise<string> => {
    if (scriptedAnswers) {
      stdout.write(prompt);
      return (scriptedAnswers.shift() ?? "").trim();
    }

    return ((await rl!.question(prompt)) ?? "").trim();
  };

  try {
    const url = (await ask("GitLab URL (https://gitlab.com): ")) || "https://gitlab.com";

    const tokenEnvVar =
      (await ask("Token environment variable (GITLAB_TOKEN): ")) || "GITLAB_TOKEN";

    // Optional additional secrets
    const secrets: SecretEntry[] = [];

    while (true) {
      const answer = (await ask("Add another secret? (y/N): ")).toLowerCase();
      if (answer !== "y") break;

      const env = await ask("  Secret env var name inside sandbox: ");
      if (!env) {
        console.log("  Skipped – name cannot be empty.");
        continue;
      }

      const from = await ask("  Source on host (env:VARIABLE): ");
      if (!from) {
        console.log("  Skipped – source cannot be empty.");
        continue;
      }

      const allow = await ask(
        "  Allowed host(s) (comma-separated, e.g. api.example.com): ",
      );
      const allowList = allow
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      secrets.push({
        env,
        from,
        allow: allowList.length === 1 ? allowList[0] : allowList,
      });

      console.log(
        `  Added secret "${env}" → ${from}` +
          (allowList.length > 0
            ? ` allowed to ${allowList.length} host(s)`
            : ""),
      );
    }

    const dockerAnswer = (
      await ask("Enable Docker support? (requires the stock agent-sandbox image) (y/N): ")
    ).toLowerCase();
    const dockerEnabled = dockerAnswer === "y";

    const config = buildProjectConfig(url, tokenEnvVar, secrets, dockerEnabled);
    addProject(name, config);
    console.log(`\n✅ Project "${name}" added.`);
  } finally {
    rl?.close();
  }
}