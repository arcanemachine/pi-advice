import { describe, expect, it } from "vitest";

import {
  adviseCompletions,
  adviseEveryCompletions,
  ADVISE_EVERY_USAGE,
  ADVISE_USAGE,
  parseAdvise,
  parseAdviseEvery,
} from "../src/command.js";

describe("parseAdvise", () => {
  it("bare advise is valid and tool-free", () => {
    expect(parseAdvise("")).toEqual({
      kind: "advise",
      tools: false,
      context: "",
    });
    expect(parseAdvise("   ")).toEqual({
      kind: "advise",
      tools: false,
      context: "",
    });
  });

  it("treats plain text as additional context", () => {
    expect(parseAdvise("focus on correctness")).toEqual({
      kind: "advise",
      tools: false,
      context: "focus on correctness",
    });
  });

  it("accepts --tools with and without context", () => {
    expect(parseAdvise("--tools")).toEqual({
      kind: "advise",
      tools: true,
      context: "",
    });
    expect(parseAdvise("--tools inspect first")).toEqual({
      kind: "advise",
      tools: true,
      context: "inspect first",
    });
  });

  it("rejects an unknown leading option with usage", () => {
    const result = parseAdvise("--verbose something");
    expect(result.kind).toBe("usage");
    expect(result).toEqual({
      kind: "usage",
      error: ADVISE_USAGE,
    });
  });

  it("does not treat a later --tools as an option", () => {
    // `--tools` is recognized only in the leading option position.
    const result = parseAdvise("focus --tools");
    expect(result).toEqual({
      kind: "advise",
      tools: false,
      context: "focus --tools",
    });
  });
});

describe("parseAdviseEvery", () => {
  it("requires arguments", () => {
    expect(parseAdviseEvery("").kind).toBe("usage");
  });

  it("parses a positive integer interval", () => {
    expect(parseAdviseEvery("50")).toEqual({
      kind: "schedule",
      every: 50,
      tools: false,
      context: "",
    });
  });

  it("parses interval with context", () => {
    expect(
      parseAdviseEvery("50 focus on correctness and overlooked risks"),
    ).toEqual({
      kind: "schedule",
      every: 50,
      tools: false,
      context: "focus on correctness and overlooked risks",
    });
  });

  it("parses interval with --tools and optional context", () => {
    expect(parseAdviseEvery("50 --tools")).toEqual({
      kind: "schedule",
      every: 50,
      tools: true,
      context: "",
    });
    expect(
      parseAdviseEvery("50 --tools inspect the relevant implementation first"),
    ).toEqual({
      kind: "schedule",
      every: 50,
      tools: true,
      context: "inspect the relevant implementation first",
    });
  });

  it("parses off", () => {
    expect(parseAdviseEvery("off")).toEqual({ kind: "off" });
  });

  it("rejects off with trailing arguments", () => {
    const result = parseAdviseEvery("off 50");
    expect(result.kind).toBe("usage");
    expect(result).toEqual({
      kind: "usage",
      error: "/advise-every off takes no arguments.\n\n" + ADVISE_EVERY_USAGE,
    });
  });

  it.each(["0", "-1", "1.5", "abc", "3.0", "1e3", "0x5"])(
    "rejects invalid interval %s",
    (arg) => {
      const result = parseAdviseEvery(arg);
      expect(result.kind).toBe("usage");
      expect(result).toEqual({
        kind: "usage",
        error: ADVISE_EVERY_USAGE,
      });
    },
  );

  it("rejects an unsafe integer", () => {
    const result = parseAdviseEvery(`${Number.MAX_SAFE_INTEGER + 1}`);
    expect(result.kind).toBe("usage");
    expect(result).toEqual({
      kind: "usage",
      error: ADVISE_EVERY_USAGE,
    });
  });

  it("rejects an unknown leading option after the interval", () => {
    const result = parseAdviseEvery("5 --verbose");
    expect(result.kind).toBe("usage");
    expect(result).toEqual({
      kind: "usage",
      error: ADVISE_EVERY_USAGE,
    });
  });
});

describe("adviseCompletions", () => {
  it("offers --tools at the initial position", () => {
    expect(adviseCompletions("")).toEqual([
      expect.objectContaining({ value: "--tools" }),
    ]);
  });

  it("offers --tools while typing it", () => {
    expect(adviseCompletions("--t")).toEqual([
      expect.objectContaining({ value: "--tools" }),
    ]);
  });

  it("returns null for plain context typing", () => {
    expect(adviseCompletions("focus")).toBeNull();
  });

  it("returns null for an unrelated option prefix", () => {
    expect(adviseCompletions("--x")).toBeNull();
  });
});

describe("adviseEveryCompletions", () => {
  it("offers off at the first argument position", () => {
    expect(adviseEveryCompletions("")).toEqual([
      expect.objectContaining({ value: "off" }),
    ]);
    expect(adviseEveryCompletions("of")).toEqual([
      expect.objectContaining({ value: "off" }),
    ]);
  });

  it("offers --tools after a valid interval and whitespace", () => {
    expect(adviseEveryCompletions("50 ")).toEqual([
      expect.objectContaining({ value: "--tools" }),
    ]);
    expect(adviseEveryCompletions("50 --t")).toEqual([
      expect.objectContaining({ value: "--tools" }),
    ]);
  });

  it("returns null while typing the interval number", () => {
    expect(adviseEveryCompletions("5")).toBeNull();
  });

  it("returns null for an unrelated option after the interval", () => {
    expect(adviseEveryCompletions("50 --x")).toBeNull();
  });
});
