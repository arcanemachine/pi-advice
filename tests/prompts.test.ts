import { describe, expect, it } from "vitest";

import { buildAdvisorPrompt, buildContinuationPrompt } from "../src/prompts.js";

describe("buildAdvisorPrompt", () => {
  it("includes the base review contract and the tool-free rule by default", () => {
    const prompt = buildAdvisorPrompt({ tools: false, context: "" });
    expect(prompt).toContain("You are the advisor.");
    expect(prompt).toContain("Recommended next action for the advisee:");
    expect(prompt).toContain("You have no tools available");
    expect(prompt).not.toContain("investigate so your advice is grounded");
    expect(prompt).not.toContain("Additional focus supplied by the user:");
  });

  it("switches to the tool-enabled rules with --tools", () => {
    const prompt = buildAdvisorPrompt({ tools: true, context: "" });
    expect(prompt).toContain("investigate so your advice is grounded");
    expect(prompt).toContain(
      "Do not modify the project, execute the plan, or perform the advisee's work",
    );
    expect(prompt).not.toContain("You have no tools available");
  });

  it("appends user context in a clearly delimited section", () => {
    const prompt = buildAdvisorPrompt({
      tools: false,
      context: "focus on whether the approach matches the plan",
    });
    expect(prompt).toContain(
      "Additional focus supplied by the user:\nfocus on whether the approach matches the plan",
    );
  });

  it("omits the context section when context is blank", () => {
    const blank = buildAdvisorPrompt({ tools: false, context: "   " });
    expect(blank).not.toContain("Additional focus supplied by the user:");
  });
});

describe("buildContinuationPrompt", () => {
  it("tells the advisee to continue acting, not merely acknowledge", () => {
    const prompt = buildContinuationPrompt();
    expect(prompt).toContain("You are the advisee.");
    expect(prompt).toContain("Continue the current work now.");
    expect(prompt).toContain(
      "exercising your own judgment rather than following the advice blindly",
    );
    expect(prompt).toContain(
      "Take the next appropriate action instead of merely acknowledging",
    );
    expect(prompt).toContain("If no legitimate work remains");
  });
});
