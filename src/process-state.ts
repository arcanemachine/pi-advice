/**
 * Process-local carrier for the active `/advice-every` schedule.
 *
 * Lifetime contract (PLAN.md):
 * - The schedule survives idle `/reload` (same Pi process, extension code is
 *   re-evaluated) because the state object lives on `globalThis` under a
 *   `Symbol.for(...)` key.
 * - It does NOT survive a Pi process restart, and it never propagates to
 *   another session: the stored `sessionId` is rechecked on reload.
 * - It is never serialized to the session, written to a file, placed in
 *   `process.env`, or passed through command arguments.
 *
 * The single shared object is reused in place across extension re-evaluation so
 * freshly evaluated code observes the same state. This mirrors the simple
 * versioned `globalThis[Symbol.for(...)]` pattern used by pi-session-manager.
 */

export interface AdviceSchedule {
  /** Session id the schedule belongs to. Mismatch on reload clears it. */
  sessionId: string;
  /** Positive safe integer; trigger after this many advisee low-level turns. */
  every: number;
  /** Whether automatic cycles may use the advisee's active tools. */
  tools: boolean;
  /** Optional free-form focus applied to every automatic cycle. */
  context: string;
  /** Low-level advisee turns counted this interval. */
  count: number;
}

interface ProcessAdviceStateV1 {
  readonly version: 1;
  schedule: AdviceSchedule | null;
}

const STATE_SYMBOL = Symbol.for("pi-advice.schedule.v1");

function isSchedule(value: unknown): value is AdviceSchedule {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.sessionId === "string" &&
    typeof s.every === "number" &&
    Number.isSafeInteger(s.every) &&
    typeof s.tools === "boolean" &&
    typeof s.context === "string" &&
    typeof s.count === "number" &&
    Number.isFinite(s.count)
  );
}

function isState(value: unknown): value is ProcessAdviceStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return s.version === 1 && (s.schedule === null || isSchedule(s.schedule));
}

function readRaw(): unknown {
  return (globalThis as Record<symbol, unknown>)[STATE_SYMBOL];
}

/** Initialize or reuse the shared process-global schedule state. */
export function getState(): ProcessAdviceStateV1 {
  const current = readRaw();
  if (isState(current)) {
    return current;
  }
  const fresh: ProcessAdviceStateV1 = { version: 1, schedule: null };
  (globalThis as Record<symbol, unknown>)[STATE_SYMBOL] = fresh;
  return fresh;
}

/** Current schedule, or `null` when no automatic cadence is active. */
export function getSchedule(): AdviceSchedule | null {
  return getState().schedule;
}

/**
 * Replace the schedule. Mutates the shared state object in place so identity
 * stays stable across re-evaluation. Pass `null` to disable.
 */
export function setSchedule(schedule: AdviceSchedule | null): void {
  getState().schedule = schedule;
}

/** Clear the automatic schedule (equivalent to `setSchedule(null)`). */
export function clearSchedule(): void {
  getState().schedule = null;
}

/**
 * Test-only reset seam. Restores the shared state to a fresh disabled default.
 * Not registered as a command or tool and must not be reachable from the agent.
 */
export function resetProcessState(): void {
  (globalThis as Record<symbol, unknown>)[STATE_SYMBOL] = {
    version: 1,
    schedule: null,
  };
}
