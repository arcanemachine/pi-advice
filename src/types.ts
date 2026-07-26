/**
 * Shared type aliases for pi-advice.
 *
 * `ThinkingLevel` mirrors Pi's own union. It is duplicated here so the package
 * can be understood and tested without importing Pi's internal type graph; the
 * literals are kept identical so assignments to and from Pi's API stay sound.
 */

/** Pi thinking-level values, in the order Pi surfaces them. */
export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Notification severity compatible with `ctx.ui.notify`. */
export type NotifyLevel = "info" | "warning" | "error";
