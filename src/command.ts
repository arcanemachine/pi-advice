/**
 * Command parsing, usage text, and autocomplete for `/advise` and `/advise-every`.
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

/** Marker option enabling the active tool set for a cycle. */
const TOOLS_OPTION = "--tools";

/** Representative forms shown for malformed `/advise-every` input. */
export const ADVISE_EVERY_USAGE = [
  "Usage:",
  "  /advise-every 50",
  "  /advise-every 50 focus on correctness and overlooked risks",
  "  /advise-every 50 --tools",
  "  /advise-every 50 --tools inspect the relevant implementation first",
  "  /advise-every off",
].join("\n");

/** Representative forms shown for malformed `/advise` input. */
export const ADVISE_USAGE = [
  "Usage:",
  "  /advise",
  "  /advise focus on whether the current approach matches the plan",
  "  /advise --tools",
  "  /advise --tools inspect the relevant implementation before reconsidering",
].join("\n");

export interface AdviseCommand {
  kind: "advise";
  tools: boolean;
  context: string;
}

export interface AdviseEveryOff {
  kind: "off";
}

export interface AdviseEverySchedule {
  kind: "schedule";
  every: number;
  tools: boolean;
  context: string;
}

export interface CommandUsage {
  kind: "usage";
  error: string;
}

export type AdviseParseResult = AdviseCommand | CommandUsage;
export type AdviseEveryParseResult =
  | AdviseEverySchedule
  | AdviseEveryOff
  | CommandUsage;

/**
 * Parse `/advise` arguments.
 *
 * `--tools` is recognized only in the leading option position. Any other
 * leading `--...` option yields usage rather than being treated as context. All
 * remaining text after an accepted leading token is opaque additional context.
 */
export function parseAdvise(args: string): AdviseParseResult {
  const trimmed = args.trim();
  if (trimmed === "") {
    return { kind: "advise", tools: false, context: "" };
  }

  const firstToken = trimmed.split(/\s+/)[0] ?? "";
  if (firstToken === TOOLS_OPTION) {
    const context = trimmed.slice(TOOLS_OPTION.length).trim();
    return { kind: "advise", tools: true, context };
  }
  if (firstToken.startsWith("--")) {
    return { kind: "usage", error: ADVISE_USAGE };
  }
  return { kind: "advise", tools: false, context: trimmed };
}

/**
 * Parse `/advise-every` arguments.
 *
 * The first token is either `off` (with no trailing args) or a positive safe
 * integer. After the interval, `--tools` may appear as an immediate option;
 * remaining text is opaque context. Zero, negatives, decimals, non-numeric
 * values, unsafe integers, and unknown leading options all surface usage.
 */
export function parseAdviseEvery(args: string): AdviseEveryParseResult {
  const trimmed = args.trim();
  if (trimmed === "") {
    return { kind: "usage", error: ADVISE_EVERY_USAGE };
  }

  const tokens = trimmed.split(/\s+/);
  const first = tokens[0] ?? "";

  if (first === "off") {
    if (tokens.length > 1) {
      return {
        kind: "usage",
        error: "/advise-every off takes no arguments.\n\n" + ADVISE_EVERY_USAGE,
      };
    }
    return { kind: "off" };
  }

  // Interval must be a positive safe integer.
  if (!/^\d+$/.test(first)) {
    return { kind: "usage", error: ADVISE_EVERY_USAGE };
  }
  const every = Number(first);
  if (first === "0" || !Number.isSafeInteger(every) || every < 1) {
    return { kind: "usage", error: ADVISE_EVERY_USAGE };
  }

  const rest = trimmed.slice(first.length).trim();
  return parseAfterInterval(every, rest);
}

function parseAfterInterval(
  every: number,
  rest: string,
): AdviseEveryParseResult {
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
    return { kind: "usage", error: ADVISE_EVERY_USAGE };
  }

  return { kind: "schedule", every, tools: false, context: rest };
}

const TOOLS_COMPLETION: CommandCompletion = {
  value: TOOLS_OPTION,
  label: TOOLS_OPTION,
  description: "Let the reconsidering model investigate with the active tools",
};

const OFF_COMPLETION: CommandCompletion = {
  value: "off",
  label: "off",
  description: "Disable the automatic advise schedule",
};

function matches(prefix: string, candidate: string): boolean {
  return candidate.startsWith(prefix);
}

/**
 * Completions for `/advise`. Offers `--tools` at the initial argument position
 * and returns `null` otherwise so Pi's normal completion behavior is intact.
 */
export function adviseCompletions(prefix: string): CommandCompletion[] | null {
  if (prefix === "" || matches(prefix, TOOLS_OPTION)) {
    return [TOOLS_COMPLETION];
  }
  return null;
}

/**
 * Completions for `/advise-every`. Offers `off` at the first argument position
 * and `--tools` after a valid interval followed by separating whitespace.
 */
export function adviseEveryCompletions(
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
