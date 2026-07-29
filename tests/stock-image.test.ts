import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONTAINERFILE_PATH } from "../src/stock-image/constants.js";

describe("Containerfile", () => {
  test("exists and keeps /root/.local/bin between mise and system paths", () => {
    const content = readFileSync(CONTAINERFILE_PATH, "utf8");
    const pathLine = content.match(/^ENV PATH=.*$/m)?.[0] ?? "";
    expect(content).toContain("FROM ubuntu:24.04");
    expect(content).toContain("MISE_VERSION");
    expect(content).toContain("docker-ce");
    expect(content).toContain("docker-up");
    expect(content).toContain("mise-msb-bootstrap");
    expect(content).toContain("STOCK_GENERATION");
    // Bootstrap cd's into /workspace and stock sandboxes default --workdir there.
    expect(content).toContain("WORKDIR /workspace");
    expect(pathLine).toContain("/mise/shims:/mise/data/bin:/root/.local/bin:");
    expect(pathLine.indexOf("/mise/shims")).toBeLessThan(pathLine.indexOf("/mise/data/bin"));
    expect(pathLine.indexOf("/mise/data/bin")).toBeLessThan(pathLine.indexOf("/root/.local/bin"));
    expect(pathLine.indexOf("/root/.local/bin")).toBeLessThan(pathLine.indexOf("/usr/local/bin"));
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
  test("personal bootstrap uses the full bootstrap command", () => {
    const script = readFileSync(
      new URL("../src/stock-image/mise-msb-bootstrap", import.meta.url),
      "utf8",
    );
    expect(script).toContain("mise bootstrap --cd /tmp/mise-msb-personal-bootstrap --yes");
    expect(script).toContain("mkdir -p /tmp/mise-msb-personal-bootstrap");
    expect(script).toContain("MARKER");
    expect(script).toContain("personal");
  });

  test("project bootstrap keeps locked and unlocked mise install behavior", () => {
    const script = readFileSync(
      new URL("../src/stock-image/mise-msb-bootstrap", import.meta.url),
      "utf8",
    );
    expect(script).toContain("project");
    expect(script).toContain("mise trust");
    expect(script).toContain("if [ -f mise.lock ]; then");
    expect(script).toContain("--locked");
    expect(script).toContain("env -u MISE_GLOBAL_CONFIG_FILE mise install --locked");
    expect(script).toContain("else");
    expect(script).toContain("mise install");
  });
});
