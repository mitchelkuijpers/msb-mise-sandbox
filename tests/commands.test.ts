/**
 * Unit tests for new command helpers.
 *
 * Covers pure parsing/helper functions from:
 * - project-add.ts  (buildProjectConfig)
 * - project-list.ts (buildProjectRows)
 * - doctor.ts       (runChecks, printResults)
 */

import { describe, it, expect } from "vitest";
import { buildProjectConfig } from "../src/commands/project-add.js";
import { buildProjectRows } from "../src/commands/project-list.js";
import { runChecks, printResults } from "../src/commands/doctor.js";

// ---------------------------------------------------------------------------
// project-add
// ---------------------------------------------------------------------------

describe("buildProjectConfig", () => {
  it("builds config with gitlab and no extra secrets", () => {
    const cfg = buildProjectConfig("https://gitlab.example.com", "MY_TOKEN", []);
    expect(cfg).toEqual({
      gitlab: { url: "https://gitlab.example.com", tokenRef: "env:MY_TOKEN" },
      secrets: [
        {
          env: "MY_TOKEN",
          from: "env:MY_TOKEN",
          allow: "gitlab.example.com",
        },
      ],
    });
  });

  it("builds config with additional secrets", () => {
    const cfg = buildProjectConfig("https://gitlab.com", "GITLAB_TOKEN", [
      { env: "NPM_TOKEN", from: "env:NPM_TOKEN", allow: "registry.npmjs.org" },
    ]);
    expect(cfg.gitlab.tokenRef).toBe("env:GITLAB_TOKEN");
    expect(cfg.secrets).toHaveLength(2);
    expect(cfg.secrets![0].env).toBe("GITLAB_TOKEN");
    expect(cfg.secrets![0].allow).toBe("gitlab.com");
    expect(cfg.secrets![1].env).toBe("NPM_TOKEN");
  });
});

// ---------------------------------------------------------------------------
// project-list
// ---------------------------------------------------------------------------

describe("buildProjectRows", () => {
  it("returns empty array for empty registry", () => {
    expect(buildProjectRows({})).toEqual([]);
  });

  it("builds rows with secret env names", () => {
    const projects = {
      alpha: {
        gitlab: { url: "https://gitlab.com/a", tokenRef: "env:TA" },
        secrets: [
          { env: "TOKEN_A", from: "env:TA", allow: "gitlab.com" },
          { env: "TOKEN_B", from: "env:TB", allow: "api.example.com" },
        ],
      },
      beta: {
        gitlab: { url: "https://gitlab.com/b", tokenRef: "env:TB" },
      },
    };

    const rows = buildProjectRows(projects);
    expect(rows).toHaveLength(2);

    expect(rows[0].name).toBe("alpha");
    expect(rows[0].gitlabUrl).toBe("https://gitlab.com/a");
    expect(rows[0].secretEnvNames).toEqual(["TOKEN_A", "TOKEN_B"]);

    expect(rows[1].name).toBe("beta");
    expect(rows[1].secretEnvNames).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

describe("runChecks", () => {
  it("passes all checks when none throw", async () => {
    const results = await runChecks([
      { label: "a", run: () => {} },
      { label: "b", run: () => {} },
    ]);
    expect(results).toEqual([
      { label: "a", passed: true },
      { label: "b", passed: true },
    ]);
  });

  it("records failures when checks throw", async () => {
    const results = await runChecks([
      { label: "ok", run: () => {} },
      { label: "fail", run: () => { throw new Error("broken"); } },
    ]);
    expect(results).toEqual([
      { label: "ok", passed: true },
      { label: "fail", passed: false, error: "broken" },
    ]);
  });

  it("handles async checks", async () => {
    const results = await runChecks([
      {
        label: "slow",
        run: async () => {
          await Promise.resolve();
        },
      },
    ]);
    expect(results).toEqual([{ label: "slow", passed: true }]);
  });
});

describe("printResults", () => {
  it("returns true when all passed", () => {
    const ok = printResults([
      { label: "a", passed: true },
      { label: "b", passed: true },
    ]);
    expect(ok).toBe(true);
  });

  it("returns false when any fail", () => {
    const ok = printResults([
      { label: "a", passed: true },
      { label: "b", passed: false, error: "boom" },
    ]);
    expect(ok).toBe(false);
  });
});
