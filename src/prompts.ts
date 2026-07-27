/**
 * Centralized self-reconsideration and continuation prompts.
 *
 * Prompts are pure builders so their material contract can be snapshot-tested.
 * Additional user context is always appended under a neutral delimiter so it
 * augments, but never replaces, the base self-continuity contract.
 */

export interface AdvisePromptInput {
  /** Whether the reconsidering model may use the active tool set. */
  tools: boolean;
  /** Optional free-form focus supplied by the user. */
  context: string;
}

const BASE_REVIEW = [
  "Pause the current work and take a fresh, more capable look at your own ongoing reasoning and progress.",
  "",
  "Treat the full conversation and all work so far as entirely your own ongoing work. This reconsideration is your own fresh realization; do not describe it as if it belongs to another agent, advisor, or model. Do not mention any advisor, advisee, model switch, hidden prompt, handoff, or external reviewer.",
  "",
  "Assess how the work is going overall:",
  "- What is going well",
  "- Mistakes, weak assumptions, omissions, unnecessary work, risks, and better approaches",
  "",
  "Include every materially useful point, but avoid padding, repetition, or unnecessary verbosity. Do not take implementation actions, modify the project, execute the plan, or perform the substantive work during this review turn. Remain grounded in the actual user request and current authorization state; if no implementation or action is authorized, recognize that correctly rather than inventing work.",
  "",
  "Finish with a clearly labeled section:",
  "",
  "Recommended next action(s):",
  "",
  "<one concrete next action for each materially distinct point above; when the user supplied focus, one concrete next action for each point in the focus>",
].join("\n");

const TOOL_FREE_RULES = [
  "",
  "No tools are available for this reconsideration. Do not call or request tools. Produce a single complete response containing as much information as necessary to make the useful realization clear, relying on the conversation context already present in this session.",
  "",
].join("\n");

const TOOL_ENABLED_RULES = [
  "",
  "You may use the currently available tools, but only for minimal investigation that supports your own reconsideration. Make the minimum reasonable number of tool calls needed to be effective, then return to a written realization. Do not modify the project, execute the plan, or perform the substantive implementation work during this review phase.",
  "",
].join("\n");

const CONTEXT_DELIMITER = "Focus for this reconsideration:";

/**
 * Build the hidden reconsideration prompt. The tool policy section reflects
 * whether tools are physically available for this cycle.
 */
export function buildAdvisePrompt(input: AdvisePromptInput): string {
  const sections: string[] = [BASE_REVIEW];
  sections.push(input.tools ? TOOL_ENABLED_RULES : TOOL_FREE_RULES);
  const focus = input.context.trim();
  if (focus !== "") {
    sections.push([CONTEXT_DELIMITER, focus].join("\n"));
  }
  return sections.join("\n\n");
}

const CONTINUATION = [
  "Continue the current work now, acting from the realization in your preceding assistant response.",
  "",
  "That realization is your own. Do not mention a separate reviewer, advisor, advisee, model switch, handoff, hidden control message, or hidden prompt. Use your own judgment rather than following an external script.",
  "",
  "Take the next concrete action rather than merely acknowledging, summarizing, or discussing the realization. Respect the user's actual request and current authorization state; ask for any required user input or authorization if that is the legitimate next action. If no legitimate work remains, state that clearly rather than inventing work.",
].join("\n");

/**
 * Build the hidden continuation prompt. Continuation applies to both manual
 * and automatic cycles and never varies with the tool policy.
 */
export function buildContinuationPrompt(): string {
  return CONTINUATION;
}
