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
  "You are the advisor. The conversation already in this session is the work of the advisee.",
  "Review how the advisee's work is going right now.",
  "",
  "Assess:",
  "- how the work is going overall;",
  "- what the advisee is doing well;",
  "- mistakes, weak assumptions, omissions, unnecessary work, risks, and better approaches.",
  "",
  "Act as an advisor, not as the implementer. Do not take over the work.",
  "Include every materially useful point, but avoid padding, repetition, and unnecessary verbosity.",
  "Finish with a clearly labeled section:",
  "",
  "Recommended next action for the advisee:",
  "<one concrete next action>;",
].join("\n");

const TOOL_FREE_RULES = [
  "You have no tools available. Do not call or request tools.",
  "Answer from the conversation context already present in the session.",
].join("\n");

const TOOL_ENABLED_RULES = [
  "You may use the advisee's active tools, but only to investigate so your advice is grounded.",
  "Make the minimum reasonable number of tool calls needed to be effective, then return your advice.",
  "Do not modify the project, execute the plan, or perform the advisee's work. Tool access is for investigation supporting advice only.",
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
