/**
 * Centralized advisor and continuation prompts.
 *
 * Prompts are pure builders so their material contract can be snapshot-tested.
 * Additional user context is always appended as a clearly delimited section so
 * it can augment, but never replace, the base role boundary.
 */

export interface AdvisorPromptInput {
  /** Whether the advisor may use the advisee's active tool set. */
  tools: boolean;
  /** Optional free-form focus supplied by the user. */
  context: string;
}

const BASE_REVIEW = [
  "Take a fresh look to analyze the current situation.",
  "",
  "Assess:",
  "- How the work is going overall",
  "- What the advisee is doing well",
  "- Mistakes, weak assumptions, omissions, unnecessary work, risks, and better approaches",
  "",
  "Give yourself advice, but do not take over the work.",
  "",
  "Include every materially useful point, but avoid padding, repetition, and unnecessary verbosity.",
  "",
  "Finish with a clearly labeled section:",
  "",
  "Recommended next action(s):",
  "",
  "<one concrete next action for each point requested by the advisee>",
].join("\n");

const TOOL_FREE_RULES = [
  "",
  "I have no tools available. Do not call or request tools. Produce a single message with as much information as is necessary to clearly get the point across. Answer from the conversation context already present in the session.",
  "",
].join("\n");

const TOOL_ENABLED_RULES = [
  "",
  "I may use the available tools, but only to investigate so my advice is grounded. I must make the minimum reasonable number of tool calls needed to be effective, then return my advice.",
  "",
].join("\n");

/**
 * Build the visible advisor user message. The tool policy section reflects
 * whether tools are physically available for this cycle.
 */
export function buildAdvisorPrompt(input: AdvisorPromptInput): string {
  const sections: string[] = [BASE_REVIEW];
  sections.push(input.tools ? TOOL_ENABLED_RULES : TOOL_FREE_RULES);
  if (input.context.trim() !== "") {
    sections.push(
      ["Additional focus supplied by the user:", input.context.trim()].join(
        "\n",
      ),
    );
  }
  return sections.join("\n\n");
}

const CONTINUATION = [
  "You are the advisee. An advisor just reviewed your work in the preceding message.",
  "Continue the current work now.",
  "Use the advisor's analysis to get back on track and improve your execution, exercising your own judgment rather than following the advice blindly.",
  "Take the next appropriate action instead of merely acknowledging or summarizing the advice.",
  "If no legitimate work remains, state that clearly rather than inventing work.",
].join("\n");

/**
 * Build the visible advisee continuation user message. Continuation applies to
 * both manual and automatic advice and never varies with the tool policy.
 */
export function buildContinuationPrompt(): string {
  return CONTINUATION;
}
