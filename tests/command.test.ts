import { describe, expect, it } from "vitest";

import {
  adviceCompletions,
  adviceEveryCompletions,
  parseAdvice,
  parseAdviceEvery,
} from "../src/command.js";

describe("parseAdvice", () => {
  it("bare advice is valid and tool-free", () => {
    expect(parseAdvice("")).toEqual({
      kind: "advice",
      tools: false,
      context: "",
    });
    expect(parseAdvice("   ")).toEqual({
      kind: "advice",
      tools: false,
      context: "",
    });
  });

  it("treats plain text as additional context", () => {
    expect(parseAdvice("focus on correctness")).toEqual({
      kind: "advice",
      tools: false,
      context: "focus on correctness",
    });
  });

  it("accepts --tools with and without context", () => {
    expect(parseAdvice("--tools")).toEqual({
      kind: "advice",
      tools: true,
      context: "",
    });
    expect(parseAdvice("--tools inspect first")).toEqual({
      kind: "advice",
      tools: true,
      context: "inspect first",
    });
  });

  it("rejects an unknown leading option with usage", () => {
    const result = parseAdvice("--verbose something");
    expect(result.kind).toBe("usage");
  });

  it("does not treat a later --tools as an option", () => {
    // `--tools` is recognized only in the leading option position.
    const result = parseAdvice("focus --tools");
    expect(result).toEqual({
      kind: "advice",
      tools: false,
      context: "focus --tools",
    });
  });
});

describe("parseAdviceEvery", () => {
  it("requires arguments", () => {
    expect(parseAdviceEvery("").kind).toBe("usage");
  });

  it("parses a positive integer interval", () => {
    expect(parseAdviceEvery("50")).toEqual({
      kind: "schedule",
      every: 50,
      tools: false,
      context: "",
    });
  });

  it("parses interval with context", () => {
    expect(
      parseAdviceEvery("50 focus on correctness and overlooked risks"),
    ).toEqual({
      kind: "schedule",
      every: 50,
      tools: false,
      context: "focus on correctness and overlooked risks",
    });
  });

  it("parses interval with --tools and optional context", () => {
    expect(parseAdviceEvery("50 --tools")).toEqual({
      kind: "schedule",
      every: 50,
      tools: true,
      context: "",
    });
    expect(
      parseAdviceEvery("50 --tools inspect the relevant implementation first"),
    ).toEqual({
      kind: "schedule",
      every: 50,
      tools: true,
      context: "inspect the relevant implementation first",
    });
  });

  it("parses off", () => {
    expect(parseAdviceEvery("off")).toEqual({ kind: "off" });
  });

  it("rejects off with trailing arguments", () => {
    expect(parseAdviceEvery("off 50").kind).toBe("usage");
  });

  it.each(["0", "-1", "1.5", "abc", "3.0", "1e3", "0x5"])(
    "rejects invalid interval %s",
    (arg) => {
      expect(parseAdviceEvery(arg).kind).toBe("usage");
    },
  );

  it("rejects an unsafe integer", () => {
    expect(parseAdviceEvery(`${Number.MAX_SAFE_INTEGER + 1}`).kind).toBe(
      "usage",
    );
  });

  it("rejects an unknown leading option after the interval", () => {
    expect(parseAdviceEvery("5 --verbose").kind).toBe("usage");
  });
});

describe("adviceCompletions", () => {
  it("offers --tools at the initial position", () => {
    expect(adviceCompletions("")).toEqual([
      expect.objectContaining({ value: "--tools" }),
    ]);
  });

  it("offers --tools while typing it", () => {
    expect(adviceCompletions("--t")).toEqual([
      expect.objectContaining({ value: "--tools" }),
    ]);
  });

  it("returns null for plain context typing", () => {
    expect(adviceCompletions("focus")).toBeNull();
  });

  it("returns null for an unrelated option prefix", () => {
    expect(adviceCompletions("--x")).toBeNull();
  });
});

describe("adviceEveryCompletions", () => {
  it("offers off at the first argument position", () => {
    expect(adviceEveryCompletions("")).toEqual([
      expect.objectContaining({ value: "off" }),
    ]);
    expect(adviceEveryCompletions("of")).toEqual([
      expect.objectContaining({ value: "off" }),
    ]);
  });

  it("offers --tools after a valid interval and whitespace", () => {
    expect(adviceEveryCompletions("50 ")).toEqual([
      expect.objectContaining({ value: "--tools" }),
    ]);
    expect(adviceEveryCompletions("50 --t")).toEqual([
      expect.objectContaining({ value: "--tools" }),
    ]);
  });

  it("returns null while typing the interval number", () => {
    expect(adviceEveryCompletions("5")).toBeNull();
  });

  it("returns null for an unrelated option after the interval", () => {
    expect(adviceEveryCompletions("50 --x")).toBeNull();
  });
});
