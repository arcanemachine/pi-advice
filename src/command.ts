/**
 * Command parsing, usage text, and autocomplete for `/advice` and `/advice-every`.
 *
 * Parsing is pure so it can be tested exhaustively without a Pi context. The
 * rules enforce the approved command forms and surface concise usage for
 * malformed input rather than silently treating options as context.
 */

/** Structural shape of a Pi autocomplete item, kept local so the package stays standalone. */
export interface CommandCompletion {
  value: string;
  label: string;
  description?: string;
}

/** Marker option enabling the advisee's active tool set for a cycle. */
const TOOLS_OPTION = "--tools";

/** Representative forms shown for malformed `/advice-every` input. */
export const ADVICE_EVERY_USAGE = [
  "Usage:",
  "  /advice-every 50",
  "  /advice-every 50 focus on correctness and overlooked risks",
  "  /advice-every 50 --tools",
  "  /advice-every 50 --tools inspect the relevant implementation first",
  "  /advice-every off",
].join("\n");

/** Representative forms shown for malformed `/advice` input. */
export const ADVICE_USAGE = [
  "Usage:",
  "  /advice",
  "  /advice focus on whether the current approach matches the plan",
  "  /advice --tools",
  "  /advice --tools inspect the relevant implementation before advising",
].join("\n");

export interface AdviceCommand {
  kind: "advice";
  tools: boolean;
  context: string;
}

export interface AdviceEveryOff {
  kind: "off";
}

export interface AdviceEverySchedule {
  kind: "schedule";
  every: number;
  tools: boolean;
  context: string;
}

export interface CommandUsage {
  kind: "usage";
  error: string;
}

export type AdviceParseResult = AdviceCommand | CommandUsage;
export type AdviceEveryParseResult =
  | AdviceEverySchedule
  | AdviceEveryOff
  | CommandUsage;

/**
 * Parse `/advice` arguments.
 *
 * `--tools` is recognized only in the leading option position. Any other
 * leading `--...` option yields usage rather than being treated as context. All
 * remaining text after an accepted leading token is opaque additional context.
 */
export function parseAdvice(args: string): AdviceParseResult {
  const trimmed = args.trim();
  if (trimmed === "") {
    return { kind: "advice", tools: false, context: "" };
  }

  const firstToken = trimmed.split(/\s+/)[0] ?? "";
  if (firstToken === TOOLS_OPTION) {
    const context = trimmed.slice(TOOLS_OPTION.length).trim();
    return { kind: "advice", tools: true, context };
  }
  if (firstToken.startsWith("--")) {
    return { kind: "usage", error: ADVICE_USAGE };
  }
  return { kind: "advice", tools: false, context: trimmed };
}

/**
 * Parse `/advice-every` arguments.
 *
 * The first token is either `off` (with no trailing args) or a positive safe
 * integer. After the interval, `--tools` may appear as an immediate option;
 * remaining text is opaque context. Zero, negatives, decimals, non-numeric
 * values, unsafe integers, and unknown leading options all surface usage.
 */
export function parseAdviceEvery(args: string): AdviceEveryParseResult {
  const trimmed = args.trim();
  if (trimmed === "") {
    return { kind: "usage", error: ADVICE_EVERY_USAGE };
  }

  const tokens = trimmed.split(/\s+/);
  const first = tokens[0] ?? "";

  if (first === "off") {
    if (tokens.length > 1) {
      return {
        kind: "usage",
        error: "/advice-every off takes no arguments.\n\n" + ADVICE_EVERY_USAGE,
      };
    }
    return { kind: "off" };
  }

  // Interval must be a positive safe integer.
  if (!/^\d+$/.test(first)) {
    return { kind: "usage", error: ADVICE_EVERY_USAGE };
  }
  const every = Number(first);
  if (first === "0" || !Number.isSafeInteger(every) || every < 1) {
    return { kind: "usage", error: ADVICE_EVERY_USAGE };
  }

  const rest = trimmed.slice(first.length).trim();
  return parseAfterInterval(every, rest);
}

function parseAfterInterval(
  every: number,
  rest: string,
): AdviceEveryParseResult {
  if (rest === "") {
    return { kind: "schedule", every, tools: false, context: "" };
  }

  // `--tools` may occupy the immediate option position.
  const toolsMatch = /^--tools(?:\s+(.*))?$/s.exec(rest);
  if (toolsMatch) {
    const context = (toolsMatch[1] ?? "").trim();
    return { kind: "schedule", every, tools: true, context };
  }

  // Any other leading option is unknown.
  if (rest.startsWith("--")) {
    return { kind: "usage", error: ADVICE_EVERY_USAGE };
  }

  return { kind: "schedule", every, tools: false, context: rest };
}

const TOOLS_COMPLETION: CommandCompletion = {
  value: TOOLS_OPTION,
  label: TOOLS_OPTION,
  description: "Let the advisor investigate with the advisee's active tools",
};

const OFF_COMPLETION: CommandCompletion = {
  value: "off",
  label: "off",
  description: "Disable the automatic advice schedule",
};

function matches(prefix: string, candidate: string): boolean {
  return candidate.startsWith(prefix);
}

/**
 * Completions for `/advice`. Offers `--tools` at the initial argument position
 * and returns `null` otherwise so Pi's normal completion behavior is intact.
 */
export function adviceCompletions(prefix: string): CommandCompletion[] | null {
  if (prefix === "" || matches(prefix, TOOLS_OPTION)) {
    return [TOOLS_COMPLETION];
  }
  return null;
}

/**
 * Completions for `/advice-every`. Offers `off` at the first argument position
 * and `--tools` after a valid interval followed by separating whitespace.
 */
export function adviceEveryCompletions(
  prefix: string,
): CommandCompletion[] | null {
  // After a valid interval and separating whitespace, complete the option slot.
  const afterInterval = /^\d+\s+(.*)$/s.exec(prefix);
  if (afterInterval) {
    const optionPrefix = afterInterval[1] ?? "";
    if (optionPrefix === "" || matches(optionPrefix, TOOLS_OPTION)) {
      return [TOOLS_COMPLETION];
    }
    return null;
  }

  // First argument position: offer `off` while the user is not typing a number.
  if (prefix.startsWith("-")) {
    return null;
  }
  if (/\d/.test(prefix.charAt(0))) {
    return null;
  }
  if (prefix === "" || matches(prefix, "off")) {
    return [OFF_COMPLETION];
  }
  return null;
}
