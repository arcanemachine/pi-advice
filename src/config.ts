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
export interface RawAdviceConfig {
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
const KNOWN_KEYS = new Set<keyof RawAdviceConfig>([
  "provider",
  "model",
  "thinkingLevel",
]);

/** Validated fields from a single source, plus any errors found before merge. */
export interface ValidatedPartial {
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  errors: string[];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    typeof value === "string" &&
    THINKING_LEVELS.includes(value as ThinkingLevel)
  );
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Validate one configuration source before merging. Unknown keys and wrong
 * types are rejected with a path-specific label so the diagnostic names the
 * file that contains the problem.
 */
export function validateRawConfig(
  raw: unknown,
  sourceLabel: string,
): ValidatedPartial {
  const result: ValidatedPartial = { errors: [] };

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    result.errors.push(`${sourceLabel}: config must be a JSON object`);
    return result;
  }

  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key as keyof RawAdviceConfig)) {
      result.errors.push(`${sourceLabel}: unknown key "${key}"`);
    }
  }

  if (obj.provider !== undefined) {
    if (!isString(obj.provider) || obj.provider.trim() === "") {
      result.errors.push(
        `${sourceLabel}: "provider" must be a non-empty string`,
      );
    } else {
      result.provider = obj.provider;
    }
  }

  if (obj.model !== undefined) {
    if (!isString(obj.model) || obj.model.trim() === "") {
      result.errors.push(`${sourceLabel}: "model" must be a non-empty string`);
    } else {
      result.model = obj.model;
    }
  }

  if (obj.thinkingLevel !== undefined) {
    if (!isThinkingLevel(obj.thinkingLevel)) {
      result.errors.push(
        `${sourceLabel}: "thinkingLevel" must be one of ${THINKING_LEVELS.join(", ")}`,
      );
    } else {
      result.thinkingLevel = obj.thinkingLevel;
    }
  }

  return result;
}

/**
 * Merge raw global and project configuration. Project fields override matching
 * global fields. Only known fields participate.
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
 * Validation is strict: malformed values and unknown keys are rejected with a
 * path-specific message rather than silently coerced. `thinkingLevel` defaults
 * to "high" only when omitted; a present-but-invalid value is an error.
 */
export function validateConfig(
  raw: RawAdviceConfig,
  sourceLabel: string,
): ConfigResult {
  const errors: string[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: `${sourceLabel}: config must be a JSON object`,
    };
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key as keyof RawAdviceConfig)) {
      errors.push(`${sourceLabel}: unknown key "${key}"`);
    }
  }

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

type ReadResult =
  | { ok: true; present: true; data: unknown }
  | { ok: true; present: false }
  | { ok: false; error: string };

function readJsonFile(path: string): ReadResult {
  if (!existsSync(path)) {
    return { ok: true, present: false };
  }
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err) {
    return {
      ok: false,
      error: `${path}: unable to read config file (${describe(err)})`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return {
      ok: false,
      error: `${path}: malformed JSON (${describe(err)})`,
    };
  }
  return { ok: true, present: true, data: parsed };
}

/**
 * Load and merge advisor configuration from explicit file paths.
 *
 * This is the test seam for config loading: callers provide isolated paths for
 * the global and project files and the trust flag, so tests do not depend on
 * the developer's real home directory.
 */
export function loadConfigFromPaths(
  globalPath: string,
  projectPath: string,
  isProjectTrusted: boolean,
): ConfigResult {
  const globalRead = readJsonFile(globalPath);
  if (!globalRead.ok) {
    return { ok: false, error: globalRead.error };
  }
  const globalValidated = globalRead.present
    ? validateRawConfig(globalRead.data, "global")
    : undefined;

  let projectValidated: ValidatedPartial | undefined;
  if (isProjectTrusted) {
    const projectRead = readJsonFile(projectPath);
    if (!projectRead.ok) {
      return { ok: false, error: projectRead.error };
    }
    projectValidated = projectRead.present
      ? validateRawConfig(projectRead.data, "project")
      : undefined;
  }

  const allErrors = [
    ...(globalValidated?.errors ?? []),
    ...(projectValidated?.errors ?? []),
  ];
  if (allErrors.length > 0) {
    return { ok: false, error: allErrors.join("; ") };
  }

  const merged = mergeConfig(
    globalValidated as RawAdviceConfig,
    projectValidated as RawAdviceConfig,
  );
  const sourceLabel = projectValidated
    ? "merged global + trusted-project"
    : "global";
  return validateConfig(merged, sourceLabel);
}

/**
 * Load and merge advisor configuration.
 *
 * Reads the global file always, and the project file only when the project is
 * trusted. Each source is validated before merging so that malformed values and
 * unknown keys in one file are reported even when the other file would override
 * the same field.
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
  return loadConfigFromPaths(globalPath, projectPath, isProjectTrusted);
}

/** join() wrapper kept tiny so the getAgentDir() import stays explicit and testable. */
function joinPathSafe(...segments: string[]): string {
  return join(...segments);
}
