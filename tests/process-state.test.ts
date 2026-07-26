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
});
