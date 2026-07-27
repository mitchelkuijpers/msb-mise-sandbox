/**
 * Unit tests for the config layer (src/lib/config.ts + src/types.ts).
 *
 * Covers:
 * - Valid config validation and default application
 * - Malformed JSON handling
 * - Missing required fields
 * - Defaults applied for omitted optional fields
 * - Registry write/update preserving existing entries
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadRegistry,
  writeRegistry,
  addProject,
  removeProject,
  loadProject,
  registryPath,
} from "../src/lib/config.js";
import { applyDefaults, type ProjectConfig } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal valid project config for testing. */
function validProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    gitlab: { url: "https://gitlab.com/mygroup/myproject", tokenRef: "env:GITLAB_TOKEN" },
    ...overrides,
  };
}

const testDir = path.join(os.tmpdir(), "agent-sandbox-test-" + Date.now());
const testRegistryPath = path.join(testDir, "projects.json");

// ---------------------------------------------------------------------------
// Setup — redirect registry to a temp directory
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Override homedir to use temp directory for tests via an env var check.
  // We directly manipulate the path by patching os.homedir — instead we'll
  // just use a symlink trick. Actually the simplest approach is to set
  // HOME temporarily, but that's fragile. Instead we directly test the
  // validation/mutation functions and bypass the file-level load/write
  // to a temp dir by mocking the path.
  //
  // Clean approach: we test the exported functions directly, using
  // loadRegistry/writeRegistry which read from the real homedir. For
  // isolation, we'll use a before/after that sets up a temp registry.
  fs.mkdirSync(testDir, { recursive: true });
  // Override the registry path by setting an env var that our
  // implementation could check — but since we can't modify the
  // implementation for tests, we directly test the mutation helpers
  // and validation functions using temp files.

  // Actually, let's just use a different strategy: write test data
  // directly with writeRegistry which uses os.homedir(). For tests,
  // we'll patch the internal functions using vitest mocking.
  // The cleanest approach: we test the validate + applyDefaults logic
  // directly (pure functions), and test file operations with a temp HOME.
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests for applyDefaults / schema validation (pure logic)
// ---------------------------------------------------------------------------

describe("applyDefaults", () => {
  it("preserves provided fields", () => {
    const config: ProjectConfig = {
      image: "custom:dev",
      gitlab: { url: "https://gitlab.com/test", tokenRef: "env:TOKEN" },
      resources: { cpus: 2, memory: "4G" },
      mounts: { workspace: "/custom", root: "/custom-root" },
      network: { defaultEgress: "allow", allow: ["gitlab.com:tcp:443"] },
      secrets: [{ env: "KEY", from: "env:KEY", allow: "example.com" }],
      env: { FOO: "bar" },
      onSecretViolation: "block-and-log",
    };

    const result = applyDefaults(config);

    expect(result.image).toBe("custom:dev");
    expect(result.resources.cpus).toBe(2);
    expect(result.resources.memory).toBe("4G");
    expect(result.mounts.workspace).toBe("/custom");
    expect(result.mounts.root).toBe("/custom-root");
    expect(result.network.defaultEgress).toBe("allow");
    expect(result.network.allow).toEqual(["gitlab.com:tcp:443"]);
    expect(result.secrets).toHaveLength(1);
    expect(result.env).toEqual({ FOO: "bar" });
    expect(result.onSecretViolation).toBe("block-and-log");
  });

  it("applies defaults for omitted resources and mounts", () => {
    const config: ProjectConfig = {
      gitlab: { url: "https://gitlab.com/test", tokenRef: "env:TOKEN" },
    };

    const result = applyDefaults(config);

    expect(result.image).toBe("agent-sandbox:latest");
    expect(result.resources.cpus).toBe(4);
    expect(result.resources.memory).toBe("8G");
    expect(result.mounts.workspace).toBe("/workspace");
    expect(result.mounts.root).toBe("/root");
  });

  it("applies defaults for omitted network", () => {
    const config: ProjectConfig = {
      gitlab: { url: "https://gitlab.com/test", tokenRef: "env:TOKEN" },
    };

    const result = applyDefaults(config);

    expect(result.network.defaultEgress).toBe("deny");
    expect(result.network.allow).toEqual([]);
  });

  it("applies default onSecretViolation", () => {
    const config: ProjectConfig = {
      gitlab: { url: "https://gitlab.com/test", tokenRef: "env:TOKEN" },
    };

    const result = applyDefaults(config);

    expect(result.onSecretViolation).toBe("block");
  });

  it("applies defaults for omitted secrets and env", () => {
    const config: ProjectConfig = {
      gitlab: { url: "https://gitlab.com/test", tokenRef: "env:TOKEN" },
    };

    const result = applyDefaults(config);

    expect(result.secrets).toEqual([]);
    expect(result.env).toEqual({});
  });

  it("merges partial resources with defaults", () => {
    const config: ProjectConfig = {
      gitlab: { url: "https://gitlab.com/test", tokenRef: "env:TOKEN" },
      resources: { cpus: 8 }, // memory omitted
    };

    const result = applyDefaults(config);

    expect(result.resources.cpus).toBe(8);
    expect(result.resources.memory).toBe("8G");
  });

  it("merges partial mounts with defaults", () => {
    const config: ProjectConfig = {
      gitlab: { url: "https://gitlab.com/test", tokenRef: "env:TOKEN" },
      mounts: { workspace: "/project" }, // root omitted
    };

    const result = applyDefaults(config);

    expect(result.mounts.workspace).toBe("/project");
    expect(result.mounts.root).toBe("/root");
  });

  it("applies defaults for an omitted docker section", () => {
    const config: ProjectConfig = {
      gitlab: { url: "https://gitlab.com/test", tokenRef: "env:TOKEN" },
    };

    const result = applyDefaults(config);

    expect(result.docker.enabled).toBe(false);
    expect(result.docker.dataVolumeSize).toBe("10G");
  });

  it("preserves an enabled docker section and defaults its size", () => {
    const config: ProjectConfig = {
      gitlab: { url: "https://gitlab.com/test", tokenRef: "env:TOKEN" },
      docker: { enabled: true },
    };

    const result = applyDefaults(config);

    expect(result.docker.enabled).toBe(true);
    expect(result.docker.dataVolumeSize).toBe("10G");
  });

  it("honors a custom docker dataVolumeSize", () => {
    const config: ProjectConfig = {
      gitlab: { url: "https://gitlab.com/test", tokenRef: "env:TOKEN" },
      docker: { enabled: true, dataVolumeSize: "50G" },
    };

    const result = applyDefaults(config);

    expect(result.docker.enabled).toBe(true);
    expect(result.docker.dataVolumeSize).toBe("50G");
  });
});

// ---------------------------------------------------------------------------
// Tests for file-level load/write operations (isolated temp directory)
// ---------------------------------------------------------------------------

// To test file operations without polluting the real homedir, we
// temporarily override the registry path by restoring HOME env.
function withTempHome(fn: () => void): void {
  const origHome = process.env.HOME;
  process.env.HOME = testDir;
  try {
    fn();
  } finally {
    process.env.HOME = origHome;
  }
}

// Actually, our implementation uses os.homedir() not process.env.HOME
// for the registry path. Let's test more directly by writing/reading
// via the actual file path but using a temp dir for os.homedir().
//
// Since os.homedir() is not easily mockable in vitest without a special
// setup, we'll do a simpler approach: construct the temp registry path,
// write test JSON data to it, and test the validateRegistry function
// directly. For write/read roundtrips, we'll use writeRegistry + loadRegistry
// but manipulate HOME first.
//
// Actually the cleanest approach: use vi.mock to patch os.homedir.

import { vi } from "bun:test";

describe("file operations", () => {
  beforeEach(() => {
    // Ensure clean test dir
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("loadRegistry returns empty when file does not exist", () => {
    // Point the registry at an isolated temp home so the real
    // ~/.agent-sandbox/projects.json never influences this test.
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);
    try {
      const registry = loadRegistry();
      expect(registry).toEqual({ projects: {} });
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("addProject adds a new project", () => {
    // Mock os.homedir to return testDir
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      addProject("myproject", validProject());

      const regPath = registryPath();
      expect(fs.existsSync(regPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(regPath, "utf-8"));
      expect(content.projects.myproject).toBeDefined();
      expect(content.projects.myproject.gitlab.url).toBe("https://gitlab.com/mygroup/myproject");
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("addProject rejects duplicate names", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      addProject("myproject", validProject());
      expect(() => addProject("myproject", validProject())).toThrow(
        /already exists/,
      );
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("writeRegistry preserves existing entries", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      addProject("project-a", validProject());
      addProject("project-b", validProject());

      const reg = loadRegistry();
      expect(Object.keys(reg.projects)).toEqual(["project-a", "project-b"]);

      // Removing one should leave the other
      removeProject("project-a");
      const updated = loadRegistry();
      expect(updated.projects["project-a"]).toBeUndefined();
      expect(updated.projects["project-b"]).toBeDefined();
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("removeProject throws for non-existent project", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      expect(() => removeProject("nonexistent")).toThrow(/not found/);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("loadProject applies defaults when loading from file", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      addProject("defaults-test", validProject());

      const config = loadProject("defaults-test");
      expect(config.resources.cpus).toBe(4);
      expect(config.resources.memory).toBe("8G");
      expect(config.mounts.workspace).toBe("/workspace");
      expect(config.mounts.root).toBe("/root");
      expect(config.network.defaultEgress).toBe("deny");
      expect(config.onSecretViolation).toBe("block");
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("loadProject throws for missing project", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      expect(() => loadProject("nonexistent")).toThrow(/not found/);
    } finally {
      homedirSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests for validateRegistry (schema validation)
// ---------------------------------------------------------------------------

describe("validateRegistry", () => {
  it("accepts a valid registry", () => {
    // Use the internal validation via loadRegistry by writing a valid file
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      writeRegistry({
        projects: {
          test: validProject(),
        },
      });

      const reg = loadRegistry();
      expect(reg.projects.test).toBeDefined();
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("rejects malformed JSON", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      const fp = registryPath();
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, "{invalid json", "utf-8");

      expect(() => loadRegistry()).toThrow(/Failed to parse/);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("rejects missing gitlab field", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      writeRegistry({
        projects: {
          bad: {} as unknown as ProjectConfig,
        },
      });

      expect(() => loadRegistry()).toThrow(/missing required field 'gitlab'/);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("rejects missing projects field at top level", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      const fp = registryPath();
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, JSON.stringify({ notProjects: {} }), "utf-8");

      expect(() => loadRegistry()).toThrow(/missing required field 'projects'/);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("rejects non-string gitlab.url", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      writeRegistry({
        projects: {
          bad: {
            gitlab: { url: 123, tokenRef: "env:X" },
          } as unknown as ProjectConfig,
        },
      });

      expect(() => loadRegistry()).toThrow(/gitlab\.url.*non-empty string/);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("rejects invalid image field", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      writeRegistry({
        projects: {
          bad: {
            image: 123,
            gitlab: { url: "https://gitlab.com/test", tokenRef: "env:X" },
          } as unknown as ProjectConfig,
        },
      });

      expect(() => loadRegistry()).toThrow(/'image' must be a non-empty string/);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("rejects secrets with missing env", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      writeRegistry({
        projects: {
          bad: {
            gitlab: { url: "https://gitlab.com/test", tokenRef: "env:X" },
            secrets: [{ from: "env:TOKEN", allow: "host.com" }],
          } as unknown as ProjectConfig,
        },
      });

      expect(() => loadRegistry()).toThrow(/secrets\[0\]\.env/);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("rejects onSecretViolation with invalid value", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      writeRegistry({
        projects: {
          bad: {
            gitlab: { url: "https://gitlab.com/test", tokenRef: "env:X" },
            onSecretViolation: "not-valid",
          } as unknown as ProjectConfig,
        },
      });

      expect(() => loadRegistry()).toThrow(/onSecretViolation.*must be one of/);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("rejects non-boolean docker.enabled", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      writeRegistry({
        projects: {
          bad: {
            gitlab: { url: "https://gitlab.com/test", tokenRef: "env:X" },
            docker: { enabled: "yes" },
          } as unknown as ProjectConfig,
        },
      });

      expect(() => loadRegistry()).toThrow(/docker\.enabled.*must be a boolean/);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it.each(["10GB", "10GiB", "10g"])("rejects malformed docker.dataVolumeSize %s", (size: string) => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      writeRegistry({
        projects: {
          bad: {
            gitlab: { url: "https://gitlab.com/test", tokenRef: "env:X" },
            docker: { enabled: true, dataVolumeSize: size },
          } as unknown as ProjectConfig,
        },
      });

      expect(() => loadRegistry()).toThrow(/docker\.dataVolumeSize.*invalid value.*M \(MiB\) or G \(GiB\)/);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("rejects docker.dataVolumeSize below the 1G minimum", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      writeRegistry({
        projects: {
          bad: {
            gitlab: { url: "https://gitlab.com/test", tokenRef: "env:X" },
            docker: { enabled: true, dataVolumeSize: "512M" },
          } as unknown as ProjectConfig,
        },
      });

      expect(() => loadRegistry()).toThrow(/docker\.dataVolumeSize.*below the minimum size of 1024 MiB/);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("accepts a valid custom docker.dataVolumeSize", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDir);

    try {
      writeRegistry({
        projects: {
          ok: {
            gitlab: { url: "https://gitlab.com/test", tokenRef: "env:X" },
            docker: { enabled: true, dataVolumeSize: "2048M" },
          } as unknown as ProjectConfig,
        },
      });

      expect(() => loadRegistry()).not.toThrow();
    } finally {
      homedirSpy.mockRestore();
    }
  });
});
