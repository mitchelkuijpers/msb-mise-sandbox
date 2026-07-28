import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONTAINERFILE_PATH } from "../src/stock-image/constants.js";

describe("Containerfile", () => {
  test("exists and contains mise installation", () => {
    const content = readFileSync(CONTAINERFILE_PATH, "utf8");
    expect(content).toContain("FROM ubuntu:24.04");
    expect(content).toContain("MISE_VERSION");
    expect(content).toContain("docker-ce");
    expect(content).toContain("docker-up");
    expect(content).toContain("mise-msb-bootstrap");
    expect(content).toContain("STOCK_GENERATION");
    // Bootstrap cd's into /workspace and stock sandboxes default --workdir there.
    expect(content).toContain("WORKDIR /workspace");
    // dockerd needs iptables/nft from sbin dirs.
    expect(content).toContain("/usr/sbin");
  });
});

describe("docker-up", () => {
  test("script is executable and contains dockerd start logic", () => {
    const script = readFileSync(
      new URL("../src/stock-image/docker-up", import.meta.url),
      "utf8",
    );
    expect(script).toContain("dockerd");
    expect(script).toContain("docker info");
    expect(script).toContain("MAX_WAIT");
    expect(script).toContain("#!/bin/bash");
  });
});

describe("mise-msb-bootstrap", () => {
  test("script supports personal and project commands", () => {
    const script = readFileSync(
      new URL("../src/stock-image/mise-msb-bootstrap", import.meta.url),
      "utf8",
    );
    expect(script).toContain("personal");
    expect(script).toContain("project");
    expect(script).toContain("mise install");
    expect(script).toContain("mise trust");
    expect(script).toContain("--locked");
    expect(script).toContain("env -u MISE_GLOBAL_CONFIG_FILE mise install --locked");
    expect(script).toContain("mkdir -p /tmp/mise-msb-personal-bootstrap");
    expect(script).toContain("MARKER");
  });
});
