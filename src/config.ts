/**
 * Advisor configuration for pi-advice.
 *
 * Configuration is loaded from Pi's namespaced settings objects. Parsing and
 * validation are kept in pure helpers so they can be exercised without
 * touching the filesystem; the file loader only creates a SettingsManager and
 * delegates to those helpers.
 */

import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

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

/**
 * Load and merge advisor configuration from Pi settings objects.
 *
 * The settings manager has already parsed each settings file. Each extension
 * namespace is validated before merging so malformed values and unknown keys in
 * one source are still reported even when another source overrides that field.
 */
export function loadConfigFromSettings(
  globalSettings: unknown,
  projectSettings: unknown,
  isProjectTrusted: boolean,
): ConfigResult {
  const globalValidated = validateSettingsNamespace(
    globalSettings,
    "global settings",
  );
  const projectValidated = isProjectTrusted
    ? validateSettingsNamespace(projectSettings, "trusted project settings")
    : undefined;

  const allErrors = [
    ...(globalValidated?.errors ?? []),
    ...(projectValidated?.errors ?? []),
  ];
  if (allErrors.length > 0) {
    return { ok: false, error: allErrors.join("; ") };
  }

  const merged = mergeConfig(globalValidated, projectValidated);
  const sourceLabel = projectValidated
    ? "merged global + trusted-project settings"
    : "global settings";
  return validateConfig(merged, sourceLabel);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const SETTINGS_KEY = "pi-advice";

function validateSettingsNamespace(
  settings: unknown,
  sourceLabel: string,
): ValidatedPartial | undefined {
  if (!isRecord(settings)) {
    return { errors: [`${sourceLabel}: settings must be a JSON object`] };
  }
  if (!hasOwn(settings, SETTINGS_KEY)) return undefined;
  return validateRawConfig(
    settings[SETTINGS_KEY],
    `${sourceLabel}.${SETTINGS_KEY}`,
  );
}

function formatSettingsErrors(errors: readonly unknown[]): string {
  return errors
    .map((entry) => {
      if (!isRecord(entry)) return `settings: ${describe(entry)}`;
      const scope = typeof entry.scope === "string" ? entry.scope : "settings";
      const path = typeof entry.path === "string" ? entry.path : undefined;
      const error = "error" in entry ? entry.error : entry;
      return `${path ?? `${scope} settings`}: unable to load settings (${describe(error)})`;
    })
    .join("; ");
}

/**
 * Load advisor configuration through Pi's SettingsManager.
 *
 * Global settings are always loaded. Project settings are included only when
 * the current project is trusted, matching Pi's normal settings semantics.
 */
export function loadConfig(
  cwd: string,
  isProjectTrusted: boolean,
): ConfigResult {
  try {
    const manager = SettingsManager.create(cwd, getAgentDir(), {
      projectTrusted: isProjectTrusted,
    });
    const errors = manager.drainErrors();
    if (errors.length > 0) {
      return { ok: false, error: formatSettingsErrors(errors) };
    }
    return loadConfigFromSettings(
      manager.getGlobalSettings(),
      manager.getProjectSettings(),
      isProjectTrusted,
    );
  } catch (err) {
    return {
      ok: false,
      error: `settings: unable to load settings (${describe(err)})`,
    };
  }
}
