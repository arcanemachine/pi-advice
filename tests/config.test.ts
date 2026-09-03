import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadConfig,
  loadConfigFromSettings,
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

describe("config loading from Pi settings", () => {
  it("loads global-only configuration from its namespace", () => {
    const result = loadConfigFromSettings(
      {
        unrelated: true,
        "pi-advice": {
          provider: "openai-codex",
          model: "gpt-5.6-sol",
        },
      },
      {},
      false,
    );
    expect(result).toEqual({
      ok: true,
      config: {
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        thinkingLevel: "high",
      },
    });
  });

  it("ignores an untrusted project namespace", () => {
    const result = loadConfigFromSettings(
      {
        "pi-advice": { provider: "openai-codex", model: "gpt-5.6-sol" },
      },
      { "pi-advice": { model: "gpt-5.6-terra", unknownKey: true } },
      false,
    );
    expect(result).toEqual({
      ok: true,
      config: {
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        thinkingLevel: "high",
      },
    });
  });

  it("honors a trusted project namespace over absent global configuration", () => {
    const result = loadConfigFromSettings(
      {},
      {
        "pi-advice": {
          provider: "openai-codex",
          model: "gpt-5.6-terra",
          thinkingLevel: "max",
        },
      },
      true,
    );
    expect(result).toEqual({
      ok: true,
      config: {
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        thinkingLevel: "max",
      },
    });
  });

  it("honors a trusted partial project override", () => {
    const result = loadConfigFromSettings(
      {
        "pi-advice": {
          provider: "openai-codex",
          model: "gpt-5.6-sol",
          thinkingLevel: "high",
        },
      },
      { "pi-advice": { model: "gpt-5.6-terra" } },
      true,
    );
    expect(result).toEqual({
      ok: true,
      config: {
        provider: "openai-codex",
        model: "gpt-5.6-terra",
        thinkingLevel: "high",
      },
    });
  });

  it("rejects a malformed namespace", () => {
    const result = loadConfigFromSettings(
      { "pi-advice": ["invalid"] },
      {},
      false,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain(
        "global settings.pi-advice: config must be a JSON object",
      );
  });

  it("rejects wrong types per trusted source", () => {
    const result = loadConfigFromSettings(
      { "pi-advice": { provider: 5 } },
      { "pi-advice": { model: ["x"] } },
      true,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('global settings.pi-advice: "provider"');
      expect(result.error).toContain(
        'trusted project settings.pi-advice: "model"',
      );
    }
  });

  it("rejects a malformed global value even when project overrides it", () => {
    const result = loadConfigFromSettings(
      { "pi-advice": { provider: 5 } },
      {
        "pi-advice": { provider: "openai-codex", model: "gpt-5.6-sol" },
      },
      true,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain('global settings.pi-advice: "provider"');
  });

  it("rejects unknown fields per source", () => {
    const result = loadConfigFromSettings(
      { "pi-advice": { provider: "x", model: "y", extra: 1 } },
      { "pi-advice": { model: "z", other: 2 } },
      true,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(
        'global settings.pi-advice: unknown key "extra"',
      );
      expect(result.error).toContain(
        'trusted project settings.pi-advice: unknown key "other"',
      );
    }
  });

  it("rejects missing provider or model after namespace merge", () => {
    const result = loadConfigFromSettings(
      {},
      { "pi-advice": { thinkingLevel: "max" } },
      true,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("provider");
      expect(result.error).toContain("model");
    }
  });

  it("rejects a present-but-invalid thinking level from any source", () => {
    const result = loadConfigFromSettings(
      { "pi-advice": { provider: "x", model: "y", thinkingLevel: "ultra" } },
      {},
      false,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("thinkingLevel");
  });

  it("rejects non-object settings", () => {
    const result = loadConfigFromSettings([], {}, false);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain(
        "global settings: settings must be a JSON object",
      );
  });

  it("does not consult the old standalone config file", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advice-settings-"));
    const cwd = mkdtempSync(join(tmpdir(), "pi-advice-cwd-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "pi-advice.json"),
      JSON.stringify({ provider: "openai-codex", model: "gpt-5.6-sol" }),
    );

    try {
      const result = loadConfig(cwd, false);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('"provider"');
        expect(result.error).toContain('"model"');
      }
    } finally {
      if (previousAgentDir === undefined)
        delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      rmSync(agentDir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
