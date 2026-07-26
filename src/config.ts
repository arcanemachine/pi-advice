/**
 * Advisor configuration for pi-advice.
 *
 * Configuration is loaded from JSON files and merged so a trusted project can
 * override individual fields set globally. Parsing and validation are kept in
 * pure helpers so they can be exercised without touching the filesystem; the
 * file loader only reads bytes and delegates to those helpers.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

import { THINKING_LEVELS, type ThinkingLevel } from "./types.js";

/** Public configuration surface. Kept deliberately small for the initial version. */
export interface AdviceConfig {
  /** Provider id, e.g. "openai-codex" or "anthropic". */
  provider: string;
  /** Model id within the provider, e.g. "gpt-5.6-sol". */
  model: string;
  /** Advisor thinking level. Defaults to "high" when omitted. */
  thinkingLevel: ThinkingLevel;
}

/** Raw JSON shape used while parsing; all fields are optional until validated. */
interface RawAdviceConfig {
  provider?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
}

export interface LoadConfigResult {
  ok: true;
  config: AdviceConfig;
}

export interface LoadConfigError {
  ok: false;
  error: string;
}

export type ConfigResult = LoadConfigResult | LoadConfigError;

const DEFAULT_THINKING_LEVEL: ThinkingLevel = "high";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    typeof value === "string" &&
    THINKING_LEVELS.includes(value as ThinkingLevel)
  );
}

/**
 * Merge raw global and project configuration. Project fields override matching
 * global fields. Only known fields participate; this helper does not validate
 * types, it only combines what was present on disk.
 */
export function mergeConfig(
  global: RawAdviceConfig | undefined,
  project: RawAdviceConfig | undefined,
): RawAdviceConfig {
  const merged: RawAdviceConfig = {};
  for (const src of [global, project]) {
    if (!src) continue;
    if (src.provider !== undefined) merged.provider = src.provider;
    if (src.model !== undefined) merged.model = src.model;
    if (src.thinkingLevel !== undefined)
      merged.thinkingLevel = src.thinkingLevel;
  }
  return merged;
}

/**
 * Validate a merged raw config and produce an {@link AdviceConfig}.
 *
 * Validation is intentionally strict: malformed values are rejected with a
 * path-specific message rather than silently coerced. `thinkingLevel` defaults
 * to "high" only when omitted; a present-but-invalid value is an error.
 */
export function validateConfig(
  raw: RawAdviceConfig,
  sourceLabel: string,
): ConfigResult {
  const errors: string[] = [];

  if (!isString(raw.provider) || raw.provider.trim() === "") {
    errors.push(`${sourceLabel}: "provider" must be a non-empty string`);
  }
  if (!isString(raw.model) || raw.model.trim() === "") {
    errors.push(`${sourceLabel}: "model" must be a non-empty string`);
  }

  let thinkingLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL;
  if (raw.thinkingLevel !== undefined) {
    if (!isThinkingLevel(raw.thinkingLevel)) {
      errors.push(
        `${sourceLabel}: "thinkingLevel" must be one of ${THINKING_LEVELS.join(", ")}`,
      );
    } else {
      thinkingLevel = raw.thinkingLevel;
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: errors.join("; ") };
  }

  return {
    ok: true,
    config: {
      provider: raw.provider as string,
      model: raw.model as string,
      thinkingLevel,
    },
  };
}

function readJsonFile(path: string): RawAdviceConfig | undefined {
  if (!existsSync(path)) return undefined;
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`${path}: unable to read config file (${describe(err)})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`${path}: malformed JSON (${describe(err)})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: config must be a JSON object`);
  }
  return parsed as RawAdviceConfig;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Load and merge advisor configuration.
 *
 * Reads the global file always, and the project file only when the project is
 * trusted. The two sources are merged, then validated together so a project can
 * supply only the fields it overrides (e.g. just `model`).
 *
 * Filesystem and JSON errors are returned as an `ok: false` result with a
 * diagnostic string so command handlers can notify concisely instead of
 * throwing. Type/validation errors are likewise returned, not thrown.
 */
export function loadConfig(
  cwd: string,
  isProjectTrusted: boolean,
): ConfigResult {
  const globalPath = joinPathSafe(getAgentDir(), "pi-advice.json");
  const projectPath = joinPathSafe(cwd, CONFIG_DIR_NAME, "pi-advice.json");

  let globalRaw: RawAdviceConfig | undefined;
  let projectRaw: RawAdviceConfig | undefined;

  try {
    globalRaw = readJsonFile(globalPath);
    if (isProjectTrusted) {
      projectRaw = readJsonFile(projectPath);
    }
  } catch (err) {
    return { ok: false, error: describe(err) };
  }

  const merged = mergeConfig(globalRaw, projectRaw);
  const sourceLabel = projectRaw ? "merged global + trusted-project" : "global";
  return validateConfig(merged, sourceLabel);
}

/** join() wrapper kept tiny so the getAgentDir() import stays explicit and testable. */
function joinPathSafe(...segments: string[]): string {
  return join(...segments);
}
