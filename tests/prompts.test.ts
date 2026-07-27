import { describe, expect, it } from "vitest";

import { buildAdvisePrompt, buildContinuationPrompt } from "../src/prompts.js";

describe("buildAdvisePrompt", () => {
  it("uses self-reconsideration framing and the tool-free rule by default", () => {
    const prompt = buildAdvisePrompt({ tools: false, context: "" });
    expect(prompt).toContain(
      "take a fresh, more capable look at your own ongoing reasoning and progress",
    );
    expect(prompt).toContain(
      "Treat the full conversation and all work so far as entirely your own ongoing work",
    );
    expect(prompt).toContain("Recommended next action(s):");
    expect(prompt).toContain("No tools are available for this reconsideration");
    expect(prompt).not.toContain(
      "only for minimal investigation that supports your own reconsideration",
    );
    expect(prompt).not.toContain("Focus for this reconsideration:");
    expect(prompt).not.toContain("You are the advisor");
    expect(prompt).not.toContain("You are the advisee");
    expect(prompt).toContain(
      "Do not mention any advisor, advisee, model switch, hidden prompt, handoff, or external reviewer",
    );
  });

  it("switches to the tool-enabled rules with --tools", () => {
    const prompt = buildAdvisePrompt({ tools: true, context: "" });
    expect(prompt).toContain(
      "only for minimal investigation that supports your own reconsideration",
    );
    expect(prompt).toContain(
      "Do not modify the project, execute the plan, or perform the substantive implementation work during this review phase",
    );
    expect(prompt).not.toContain("No tools are available");
  });

  it("appends user context under a neutral delimiter", () => {
    const prompt = buildAdvisePrompt({
      tools: false,
      context: "focus on whether the approach matches the plan",
    });
    expect(prompt).toContain(
      "Focus for this reconsideration:\nfocus on whether the approach matches the plan",
    );
    expect(prompt).not.toContain("Additional focus supplied by the user");
  });

  it("trims blank context and omits the focus section", () => {
    const blank = buildAdvisePrompt({ tools: false, context: "   " });
    expect(blank).not.toContain("Focus for this reconsideration:");
  });

  it("prohibits implementation, advisor framing, and model-switch language", () => {
    const prompt = buildAdvisePrompt({
      tools: false,
      context: "check the risky assumptions",
    });
    expect(prompt).toContain(
      "Do not take implementation actions, modify the project, execute the plan, or perform the substantive work during this review turn",
    );
    expect(prompt).toContain(
      "do not describe it as if it belongs to another agent",
    );
    expect(prompt).toContain(
      "Do not mention any advisor, advisee, model switch, hidden prompt, handoff, or external reviewer",
    );
  });
});

describe("buildContinuationPrompt", () => {
  it("frames continuation as acting from the model's own realization", () => {
    const prompt = buildContinuationPrompt();
    expect(prompt).toContain(
      "Continue the current work now, acting from the realization in your preceding assistant response",
    );
    expect(prompt).toContain("That realization is your own");
    expect(prompt).toContain(
      "Take the next concrete action rather than merely acknowledging",
    );
    expect(prompt).toContain("If no legitimate work remains");
  });

  it("prohibits separate-reviewer and handoff language", () => {
    const prompt = buildContinuationPrompt();
    expect(prompt).not.toContain("You are the advisee");
    expect(prompt).not.toContain("You are the advisor");
    expect(prompt).toContain(
      "Do not mention a separate reviewer, advisor, advisee, model switch, handoff, hidden control message, or hidden prompt",
    );
  });
});
