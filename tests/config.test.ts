import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig, mergeConfig, validateConfig } from "../src/config.js";

/**
 * The config loader reads `~/.pi/agent/pi-advice.json` (which may or may not
 * exist in the test environment) plus a trusted-project file. These tests rely
 * on the pure merge/validate helpers for coverage and use a temp project file
 * for the trusted-override and untrusted-project behavior.
 */
describe("config merge and validate", () => {
  it("merges project fields over global fields", () => {
    const merged = mergeConfig(
      { provider: "openai-codex", model: "gpt-5.6-sol", thinkingLevel: "high" },
      { model: "gpt-5.6-terra" },
    );
    expect(merged).toEqual({
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      thinkingLevel: "high",
    });
  });

  it("accepts global-only configuration", () => {
    expect(
      mergeConfig(
        { provider: "anthropic", model: "claude-sonnet-4-5" },
        undefined,
      ),
    ).toEqual({ provider: "anthropic", model: "claude-sonnet-4-5" });
  });

  it("defaults thinkingLevel to high when omitted", () => {
    const result = validateConfig(
      { provider: "openai-codex", model: "gpt-5.6-sol" },
      "global",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.thinkingLevel).toBe("high");
  });

  it("rejects missing provider or model", () => {
    const result = validateConfig({ provider: "", model: "x" }, "global");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("provider");
  });

  it("rejects a present-but-invalid thinking level", () => {
    const result = validateConfig(
      {
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        thinkingLevel: "ultra",
      },
      "global",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("thinkingLevel");
  });

  it("rejects wrong field types", () => {
    const result = validateConfig(
      { provider: 5, model: ["x"], thinkingLevel: "high" },
      "global",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("provider");
      expect(result.error).toContain("model");
    }
  });
});

describe("config loading and trust gating", () => {
  const projectRoot = join(tmpdir(), "pi-advice-config-test");
  const projectPiDir = join(projectRoot, ".pi");
  const projectConfigPath = join(projectPiDir, "pi-advice.json");

  beforeEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    mkdirSync(projectPiDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("ignores untrusted project configuration", () => {
    writeFileSync(
      projectConfigPath,
      JSON.stringify({
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        thinkingLevel: "max",
      }),
    );
    // No global file present; untrusted project config is ignored → missing config.
    const result = loadConfig(projectRoot, false);
    expect(result.ok).toBe(false);
  });

  it("honors a trusted project override over (absent) global config", () => {
    writeFileSync(
      projectConfigPath,
      JSON.stringify({
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        thinkingLevel: "max",
      }),
    );
    const result = loadConfig(projectRoot, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        thinkingLevel: "max",
      });
    }
  });

  it("rejects malformed JSON in a trusted project file without throwing", () => {
    writeFileSync(projectConfigPath, "{ not json");
    const result = loadConfig(projectRoot, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/malformed JSON/);
  });
});
