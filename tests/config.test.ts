import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadConfigFromPaths,
  mergeConfig,
  type RawAdviceConfig,
  validateConfig,
  validateRawConfig,
} from "../src/config.js";

describe("config per-source validation", () => {
  it("accepts a partial source containing only a model override", () => {
    const result = validateRawConfig({ model: "gpt-5.6-terra" }, "project");
    expect(result.errors).toEqual([]);
    expect(result).toEqual({ model: "gpt-5.6-terra", errors: [] });
  });

  it("accepts a complete source with a valid thinking level", () => {
    const result = validateRawConfig(
      { provider: "openai-codex", model: "gpt-5.6-sol", thinkingLevel: "max" },
      "global",
    );
    expect(result.errors).toEqual([]);
    expect(result).toEqual({
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      thinkingLevel: "max",
      errors: [],
    });
  });

  it("rejects unknown keys with the source label", () => {
    const result = validateRawConfig(
      { provider: "x", model: "y", extra: 1 },
      "project",
    );
    expect(result.errors).toContain('project: unknown key "extra"');
  });

  it("rejects wrong types per source", () => {
    const result = validateRawConfig(
      { provider: 5, model: ["x"], thinkingLevel: true },
      "global",
    );
    expect(result.errors).toContain(
      'global: "provider" must be a non-empty string',
    );
    expect(result.errors).toContain(
      'global: "model" must be a non-empty string',
    );
    expect(result.errors).toContain(
      'global: "thinkingLevel" must be one of off, minimal, low, medium, high, xhigh, max',
    );
  });

  it("rejects non-object sources", () => {
    const result = validateRawConfig([], "global");
    expect(result.errors).toEqual(["global: config must be a JSON object"]);
  });
});

describe("config merge", () => {
  it("merges project fields over global fields", () => {
    const merged = mergeConfig(
      {
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        thinkingLevel: "high",
      },
      { model: "gpt-5.6-terra" },
    );
    expect(merged).toEqual({
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      thinkingLevel: "high",
    });
  });

  it("returns global-only configuration when project is undefined", () => {
    const merged = mergeConfig(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      undefined,
    );
    expect(merged).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
  });
});

describe("config final validation", () => {
  it("defaults thinkingLevel to high when omitted", () => {
    const result = validateConfig(
      { provider: "openai-codex", model: "gpt-5.6-sol" },
      "global",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.thinkingLevel).toBe("high");
  });

  it("rejects a missing provider or model", () => {
    const missingProvider = validateConfig(
      { provider: "", model: "x" },
      "global",
    );
    expect(missingProvider.ok).toBe(false);
    if (!missingProvider.ok)
      expect(missingProvider.error).toContain("provider");

    const missingModel = validateConfig({ provider: "x", model: "" }, "global");
    expect(missingModel.ok).toBe(false);
    if (!missingModel.ok) expect(missingModel.error).toContain("model");
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

  it("rejects unknown keys", () => {
    const result = validateConfig(
      { provider: "x", model: "y", extra: 1 } as unknown as RawAdviceConfig,
      "global",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('unknown key "extra"');
  });

  it("rejects non-object input", () => {
    const result = validateConfig([] as unknown as RawAdviceConfig, "global");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain("config must be a JSON object");
  });
});

describe("config loading from explicit paths", () => {
  const configDir = join(tmpdir(), "pi-advice-config-test");
  const globalPath = join(configDir, "global.json");
  const projectPath = join(configDir, "project", "pi-advice.json");

  beforeEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    mkdirSync(join(configDir, "project"), { recursive: true });
  });

  afterAll(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  const writeGlobal = (data: unknown) =>
    writeFileSync(globalPath, JSON.stringify(data));
  const writeProject = (data: unknown) =>
    writeFileSync(projectPath, JSON.stringify(data));

  it("loads global-only configuration", () => {
    writeGlobal({ provider: "openai-codex", model: "gpt-5.6-sol" });
    const result = loadConfigFromPaths(globalPath, projectPath, false);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.config).toEqual({
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        thinkingLevel: "high",
      });
  });

  it("ignores untrusted project configuration", () => {
    writeGlobal({ provider: "openai-codex", model: "gpt-5.6-sol" });
    writeProject({ model: "gpt-5.6-terra", unknownKey: true });
    const result = loadConfigFromPaths(globalPath, projectPath, false);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.config).toEqual({
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        thinkingLevel: "high",
      });
  });

  it("honors a trusted project override over absent global config", () => {
    writeProject({
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      thinkingLevel: "max",
    });
    const result = loadConfigFromPaths(globalPath, projectPath, true);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.config).toEqual({
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        thinkingLevel: "max",
      });
  });

  it("honors a trusted partial project override", () => {
    writeGlobal({
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      thinkingLevel: "high",
    });
    writeProject({ model: "gpt-5.6-terra" });
    const result = loadConfigFromPaths(globalPath, projectPath, true);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.config).toEqual({
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        thinkingLevel: "high",
      });
  });

  it("rejects malformed JSON in global file without throwing", () => {
    writeFileSync(globalPath, "{ not json");
    const result = loadConfigFromPaths(globalPath, projectPath, false);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/global\.json.*malformed JSON/);
  });

  it("rejects malformed JSON in trusted project file without throwing", () => {
    writeFileSync(projectPath, "{ not json");
    const result = loadConfigFromPaths(globalPath, projectPath, true);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/project.*pi-advice\.json.*malformed JSON/);
  });

  it("rejects non-object JSON without throwing", () => {
    writeGlobal([1, 2, 3]);
    const result = loadConfigFromPaths(globalPath, projectPath, false);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain("config must be a JSON object");
  });

  it("rejects wrong types per source", () => {
    writeGlobal({ provider: 5 });
    writeProject({ model: ["x"] });
    const result = loadConfigFromPaths(globalPath, projectPath, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('global: "provider"');
      expect(result.error).toContain('project: "model"');
    }
  });

  it("rejects a malformed global value even when project overrides it", () => {
    writeGlobal({ provider: 5 });
    writeProject({ provider: "openai-codex", model: "gpt-5.6-sol" });
    const result = loadConfigFromPaths(globalPath, projectPath, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('global: "provider"');
  });

  it("rejects unknown fields per source", () => {
    writeGlobal({ provider: "x", model: "y", extra: 1 });
    writeProject({ model: "z", other: 2 });
    const result = loadConfigFromPaths(globalPath, projectPath, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('global: unknown key "extra"');
      expect(result.error).toContain('project: unknown key "other"');
    }
  });

  it("rejects missing provider or model after merge", () => {
    writeProject({ thinkingLevel: "max" });
    const result = loadConfigFromPaths(globalPath, projectPath, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("provider");
      expect(result.error).toContain("model");
    }
  });

  it("rejects a present-but-invalid thinking level from any source", () => {
    writeGlobal({ provider: "x", model: "y", thinkingLevel: "ultra" });
    const result = loadConfigFromPaths(globalPath, projectPath, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("thinkingLevel");
  });

  it("returns a path-specific read error without throwing", () => {
    rmSync(globalPath, { force: true });
    mkdirSync(globalPath);
    const result = loadConfigFromPaths(globalPath, projectPath, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(globalPath);
  });

  it("does not depend on the real home directory", () => {
    writeProject({ provider: "openai-codex", model: "gpt-5.6-sol" });
    const result = loadConfigFromPaths(globalPath, projectPath, true);
    expect(result.ok).toBe(true);
  });
});
