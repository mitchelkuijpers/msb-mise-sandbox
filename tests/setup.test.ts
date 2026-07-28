import { describe, expect, test } from "bun:test";
import { planSetup } from "../src/setup/setup.js";
import { STOCK_IMAGE_TAG, CONTAINERFILE_PATH, STOCK_IMAGE_DIR } from "../src/stock-image/constants.js";

describe("planSetup", () => {
  test("produces deterministic plan groups", () => {
    const plan = planSetup({ printOnly: false, force: false });
    expect(plan.imageTag).toBe(STOCK_IMAGE_TAG);
    expect(plan.groups.length).toBeGreaterThanOrEqual(3);
    // First group should be docker build
    expect(plan.groups[0]?.[0]).toBe("docker");
    expect(plan.groups[0]?.[1]).toBe("build");
    expect(plan.groups[0]).toContain("-t");
    expect(plan.groups[0]).toContain(STOCK_IMAGE_TAG);
    // Should reference the Containerfile
    expect(plan.groups[0]).toContain("-f");
    expect(plan.groups[0]).toContain(CONTAINERFILE_PATH);
  });

  test("builds with the stock-image directory as context", () => {
    const plan = planSetup({ printOnly: false, force: false });
    const buildGroup = plan.groups[0] ?? [];
    // Context is the last argument and must contain the COPY'd helper scripts
    expect(buildGroup[buildGroup.length - 1]).toBe(STOCK_IMAGE_DIR);
  });

  test("saves the built image with docker save", () => {
    const plan = planSetup({ printOnly: false, force: false });
    const saveGroup = plan.groups[1] ?? [];
    expect(saveGroup[0]).toBe("docker");
    expect(saveGroup[1]).toBe("save");
    expect(saveGroup).toContain(STOCK_IMAGE_TAG);
    expect(saveGroup).toContain("-o");
  });

  test("specifies msb image load as last step", () => {
    const plan = planSetup({ printOnly: false, force: false });
    const lastGroup = plan.groups[plan.groups.length - 1] ?? [];
    expect(lastGroup[0]).toBe("msb");
    expect(lastGroup[1]).toBe("image");
    expect(lastGroup[2]).toBe("load");
    expect(lastGroup).toContain("--input");
    expect(lastGroup).toContain("--tag");
    expect(lastGroup).toContain(STOCK_IMAGE_TAG);
  });

  test("supports print-only mode", () => {
    const plan = planSetup({ printOnly: true, force: false });
    expect(plan.groups.length).toBeGreaterThanOrEqual(3);
  });
});
