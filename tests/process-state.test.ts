import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSchedule,
  getSchedule,
  getState,
  resetProcessState,
  setSchedule,
} from "../src/process-state.js";

const SCHEDULE_A = {
  sessionId: "sess-1",
  every: 5,
  tools: false,
  context: "",
  count: 0,
};

describe("process-global schedule state", () => {
  beforeEach(() => {
    resetProcessState();
  });

  it("is disabled by default", () => {
    expect(getSchedule()).toBeNull();
  });

  it("stores and clears a schedule in place on a stable object", () => {
    const state = getState();
    expect(state.version).toBe(1);

    setSchedule(SCHEDULE_A);
    expect(getSchedule()).toEqual(SCHEDULE_A);
    // Mutating the schedule keeps the shared state object identity stable.
    expect(getState()).toBe(state);

    clearSchedule();
    expect(getSchedule()).toBeNull();
    expect(getState()).toBe(state);
  });

  it("persists across module re-evaluation (reload) because it is a process-global Symbol", async () => {
    setSchedule(SCHEDULE_A);
    vi.resetModules();
    const reloaded = await import("../src/process-state.js");
    expect(reloaded.getSchedule()).toEqual(SCHEDULE_A);
  });

  it("resets to disabled after an explicit reset", () => {
    setSchedule(SCHEDULE_A);
    resetProcessState();
    expect(getSchedule()).toBeNull();
    // A fresh state object is created after reset.
    expect(getState().version).toBe(1);
  });

  it("reinitializes malformed process-global state to a safe disabled default", () => {
    (globalThis as Record<symbol, unknown>)[
      Symbol.for("pi-advice.schedule.v1")
    ] = { version: 1, schedule: { broken: true } };
    expect(getSchedule()).toBeNull();
  });

  it("resets the count when a new schedule replaces an old one", () => {
    setSchedule({ ...SCHEDULE_A, count: 4 });
    setSchedule({ ...SCHEDULE_A, every: 2, count: 0 });
    expect(getSchedule()?.every).toBe(2);
    expect(getSchedule()?.count).toBe(0);
  });

  it("rejects a schedule with a non-string or empty sessionId", () => {
    setSchedule({ ...SCHEDULE_A, sessionId: "" });
    expect(getSchedule()).toBeNull();

    setSchedule({ ...SCHEDULE_A, sessionId: 123 as unknown as string });
    expect(getSchedule()).toBeNull();
  });

  it("rejects a schedule with a non-positive or non-safe-integer interval", () => {
    for (const every of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      setSchedule({ ...SCHEDULE_A, every: every as unknown as number });
      expect(getSchedule()).toBeNull();
    }
  });

  it("rejects a schedule with non-boolean tools", () => {
    setSchedule({ ...SCHEDULE_A, tools: "true" as unknown as boolean });
    expect(getSchedule()).toBeNull();
  });

  it("rejects a schedule with non-string context", () => {
    setSchedule({ ...SCHEDULE_A, context: 123 as unknown as string });
    expect(getSchedule()).toBeNull();
  });

  it("rejects a schedule with a negative or non-safe-integer count", () => {
    for (const count of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      setSchedule({ ...SCHEDULE_A, count: count as unknown as number });
      expect(getSchedule()).toBeNull();
    }
  });

  it("accepts a saturated schedule where count equals every", () => {
    const saturated = { ...SCHEDULE_A, every: 3, count: 3 };
    setSchedule(saturated);
    expect(getSchedule()).toEqual(saturated);
  });

  it("persists a saturated schedule across module re-evaluation", async () => {
    const saturated = { ...SCHEDULE_A, every: 3, count: 3 };
    setSchedule(saturated);
    vi.resetModules();
    const reloaded = await import("../src/process-state.js");
    expect(reloaded.getSchedule()).toEqual(saturated);
  });

  it("rejects malformed process-global state for each required field", () => {
    const symbol = Symbol.for("pi-advice.schedule.v1");
    const base = { ...SCHEDULE_A };

    for (const schedule of [
      { ...base, sessionId: "" },
      { ...base, every: 0 },
      { ...base, every: -1 },
      { ...base, every: 1.5 },
      { ...base, tools: undefined },
      { ...base, context: undefined },
      { ...base, count: -1 },
      { ...base, count: 1.5 },
    ]) {
      (globalThis as Record<symbol, unknown>)[symbol] = {
        version: 1,
        schedule,
      };
      expect(getSchedule()).toBeNull();
    }
  });
});
