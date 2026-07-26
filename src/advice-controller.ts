/**
 * The advice cycle controller.
 *
 * This is an explicit, testable phase machine. It is decoupled from the Pi
 * ExtensionAPI through {@link AdviceDeps}; `index.ts` wires real Pi objects
 * into that interface and tests build a deterministic runtime-faithful harness.
 *
 * Activation boundary (see PLAN.md Amendment 1): Pi freezes the next
 * low-level turn's model/thinking/tools from live agent state after each
 * awaited `turn_end` handler, before the next drained steering message emits
 * `message_start`. The advisor is therefore activated (snapshot + model/thinking/
 * tool switch) BEFORE its prompt is queued, so the next-turn snapshot captures
 * the advisor. The advisee's in-flight turn keeps its already-frozen advisee
 * configuration; its `turn_end` is recognized by controller phase and is
 * neither counted nor treated as an advisor turn. Restoration happens during
 * the advisor's final `turn_end`, before Pi's next-turn snapshot, so the
 * continuation turn captures the restored advisee.
 *
 * Counting: only `idle` advisee turns increment the automatic cadence. Advisor
 * turns, queued/continuation phases, and the first continuation turn are all
 * excluded by phase, so the count never depends on fragile text matching.
 */

import type {
  MessageStartEvent,
  ModelRegistry,
  SessionShutdownEvent,
  SessionStartEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

import { parseAdvice, parseAdviceEvery } from "./command.js";
import { loadConfig, type ConfigResult } from "./config.js";
import {
  clearSchedule,
  getSchedule,
  setSchedule,
  type AdviceSchedule,
} from "./process-state.js";
import { buildAdvisorPrompt, buildContinuationPrompt } from "./prompts.js";
import type { NotifyLevel, ThinkingLevel } from "./types.js";

/** Advisor model object, derived from Pi's model registry without importing the internal Model type. */
export type AdvisorModel = NonNullable<ReturnType<ModelRegistry["find"]>>;

export type Phase =
  | "idle"
  | "adviceQueued"
  | "advisorActive"
  | "continuationQueued"
  | "adviseeContinuing";

interface AdviceSnapshot {
  model: AdvisorModel | undefined;
  thinking: ThinkingLevel;
  tools: string[];
}

interface AdviceCycle {
  advisorModel: AdvisorModel;
  thinkingLevel: ThinkingLevel;
  tools: boolean;
  context: string;
  advisorPrompt: string;
  continuationPrompt: string;
  snapshot: AdviceSnapshot | null;
}

/** Slim, injectable view of the Pi surfaces the controller needs. */
export interface AdviceDeps {
  loadConfig(): ConfigResult;
  findAdvisor(provider: string, model: string): AdvisorModel | undefined;
  hasAuth(model: AdvisorModel): boolean;

  getAdviseeModel(): AdvisorModel | undefined;
  getThinking(): ThinkingLevel;
  getActiveTools(): string[];

  setModel(model: AdvisorModel): Promise<boolean>;
  setThinking(level: ThinkingLevel): void;
  setActiveTools(names: string[]): void;

  sendUserMessage(content: string, opts?: { deliverAs?: "steer" }): void;

  isIdle(): boolean;
  hasPendingMessages(): boolean;

  notify(message: string, level: NotifyLevel): void;
  getSessionId(): string;
}

const OVERLAP_MESSAGE =
  "An advice cycle is already active. Finish or wait for the current one before requesting more advice.";
const PENDING_MESSAGE =
  "Advice cannot be queued while other steering messages are pending. Wait for them to finish, then retry /advice.";

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part !== null &&
        typeof part === "object" &&
        (part as { type?: string }).type === "text",
    )
    .map((part) => part.text)
    .join("");
}

type AssistantMessage = Extract<TurnEndEvent["message"], { role: "assistant" }>;

function assistantHasText(message: AssistantMessage): boolean {
  return message.content.some(
    (part) => part.type === "text" && part.text.trim() !== "",
  );
}

export class AdviceController {
  private phase: Phase = "idle";
  private cycle: AdviceCycle | null = null;

  constructor(private readonly deps: AdviceDeps) {}

  // ---------------------------------------------------------------------------
  // Command handlers
  // ---------------------------------------------------------------------------

  /** `/advice` command body. Validates, activates, and queues a manual advice cycle. */
  async handleAdvice(args: string): Promise<void> {
    const parsed = parseAdvice(args);
    if (parsed.kind === "usage") {
      this.deps.notify(parsed.error, "warning");
      return;
    }
    if (this.phase !== "idle") {
      this.deps.notify(OVERLAP_MESSAGE, "warning");
      return;
    }
    if (this.deps.hasPendingMessages()) {
      this.deps.notify(PENDING_MESSAGE, "warning");
      return;
    }
    await this.startCycle({
      tools: parsed.tools,
      context: parsed.context,
      source: "manual",
    });
  }

  /** `/advice-every` command body. Enables/replaces/disables the schedule. */
  handleAdviceEvery(args: string): void {
    const parsed = parseAdviceEvery(args);
    if (parsed.kind === "usage") {
      this.deps.notify(parsed.error, "warning");
      return;
    }
    if (parsed.kind === "off") {
      clearSchedule();
      this.deps.notify("Automatic advice disabled.", "info");
      return;
    }
    setSchedule({
      sessionId: this.deps.getSessionId(),
      every: parsed.every,
      tools: parsed.tools,
      context: parsed.context,
      count: 0,
    });
    this.deps.notify(
      this.scheduleEnabledMessage(parsed.every, parsed.tools, parsed.context),
      "info",
    );
  }

  private scheduleEnabledMessage(
    every: number,
    tools: boolean,
    context: string,
  ): string {
    const parts = [`Automatic advice every ${every} low-level turn(s)`];
    if (tools) parts.push("with tools");
    if (context.trim() !== "") parts.push(`focus: ${context.trim()}`);
    return parts.join(", ") + ".";
  }

  // ---------------------------------------------------------------------------
  // Cycle lifecycle
  // ---------------------------------------------------------------------------

  private async startCycle(input: {
    tools: boolean;
    context: string;
    source: "manual" | "automatic";
  }): Promise<void> {
    const config = this.deps.loadConfig();
    if (!config.ok) {
      this.deps.notify(
        `Advisor configuration is invalid: ${config.error}`,
        "error",
      );
      this.handleStartFailure(input.source);
      return;
    }

    const advisor = this.deps.findAdvisor(
      config.config.provider,
      config.config.model,
    );
    if (!advisor) {
      this.deps.notify(
        `Advisor model ${config.config.provider}/${config.config.model} not found.`,
        "error",
      );
      this.handleStartFailure(input.source);
      return;
    }
    if (!this.deps.hasAuth(advisor)) {
      this.deps.notify(
        `No API key configured for ${config.config.provider}. Run /login ${config.config.provider} to authenticate.`,
        "error",
      );
      this.handleStartFailure(input.source);
      return;
    }

    this.cycle = {
      advisorModel: advisor,
      thinkingLevel: config.config.thinkingLevel,
      tools: input.tools,
      context: input.context,
      advisorPrompt: buildAdvisorPrompt({
        tools: input.tools,
        context: input.context,
      }),
      continuationPrompt: buildContinuationPrompt(),
      snapshot: null,
    };
    // Mark the cycle pending before any async work so an overlapping command
    // request is rejected synchronously.
    this.phase = "adviceQueued";

    const activated = await this.activateAdvisor();
    if (!activated) {
      // activateAdvisor restored notification and reset local state on failure.
      this.handleStartFailure(input.source);
      return;
    }

    // Activation completed: the next-turn snapshot captured after the upcoming
    // (or just-finished) turn_end will reflect the advisor. Deliver the prompt
    // by current idle state: an idle agent runs it immediately; a streaming
    // agent receives it as the next steering message.
    if (this.deps.isIdle()) {
      this.phase = "advisorActive";
      this.deps.sendUserMessage(this.cycle!.advisorPrompt);
    } else {
      this.phase = "adviceQueued";
      this.deps.sendUserMessage(this.cycle!.advisorPrompt, {
        deliverAs: "steer",
      });
    }
  }

  /** On a failed automatic start, leave the schedule enabled and wait a full new interval. */
  private handleStartFailure(source: "manual" | "automatic"): void {
    if (source === "automatic") {
      const schedule = getSchedule();
      if (schedule) {
        schedule.count = 0;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Activation and restoration
  // ---------------------------------------------------------------------------

  /**
   * Snapshot the advisee, then switch to the advisor model/thinking/tools.
   * Returns false (with local state reset and a notification) if the advisor
   * switch is rejected; in that case no advisee state was changed by setModel.
   */
  private async activateAdvisor(): Promise<boolean> {
    const cycle = this.cycle;
    if (!cycle) return false;

    const snapshot: AdviceSnapshot = {
      model: this.deps.getAdviseeModel(),
      thinking: this.deps.getThinking(),
      tools: this.deps.getActiveTools(),
    };
    cycle.snapshot = snapshot;

    const ok = await this.deps.setModel(cycle.advisorModel);
    if (!ok) {
      const label = `${cycle.advisorModel.provider}/${cycle.advisorModel.id}`;
      cycle.snapshot = null;
      this.cycle = null;
      this.phase = "idle";
      this.deps.notify(
        `Advisor ${label} is unavailable; no advice was given.`,
        "error",
      );
      return false;
    }

    this.deps.setThinking(cycle.thinkingLevel);
    this.deps.setActiveTools(cycle.tools ? snapshot.tools : []);
    return true;
  }

  /**
   * Idempotently restore the captured advisee model, thinking, and tools.
   * Reports a restoration failure without concealing it.
   */
  private async restoreAdvisee(): Promise<void> {
    const cycle = this.cycle;
    if (!cycle?.snapshot) return; // already restored or never activated
    const snapshot = cycle.snapshot;
    cycle.snapshot = null; // mark restored so repeated calls are no-ops
    let restoreFailed = false;
    if (snapshot.model) {
      const ok = await this.deps.setModel(snapshot.model);
      if (!ok) restoreFailed = true;
    }
    this.deps.setThinking(snapshot.thinking);
    this.deps.setActiveTools(snapshot.tools);
    if (restoreFailed) {
      const label = snapshot.model
        ? `${snapshot.model.provider}/${snapshot.model.id}`
        : "(unknown)";
      this.deps.notify(
        `Failed to restore the advisee model ${label}. Switch it back manually with /model.`,
        "error",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  async onMessageStart(event: MessageStartEvent): Promise<void> {
    const message = event.message;
    if (message.role !== "user") return;
    const text = messageText(message.content);

    if (
      this.phase === "adviceQueued" &&
      this.cycle &&
      text === this.cycle.advisorPrompt
    ) {
      // The queued advisor prompt is being delivered; switch to active. (The
      // advisor was already activated before this message was queued.)
      this.phase = "advisorActive";
      return;
    }
    if (
      this.phase === "continuationQueued" &&
      this.cycle &&
      text === this.cycle.continuationPrompt
    ) {
      this.phase = "adviseeContinuing";
      return;
    }
    // advisorActive + own advisor prompt (idle immediate case): already active.
  }

  async onTurnEnd(event: TurnEndEvent): Promise<void> {
    const message = event.message;
    if (message.role !== "assistant") return;

    if (this.phase === "advisorActive") {
      await this.handleAdvisorTurnEnd(message as AssistantMessage);
      return;
    }
    if (this.phase === "adviseeContinuing") {
      // The continuation turn completes the cycle and is excluded from counting.
      this.phase = "idle";
      this.cycle = null;
      return;
    }
    if (this.phase === "idle") {
      await this.handleAdviseeIdleTurnEnd(message as AssistantMessage);
      return;
    }
    // adviceQueued / continuationQueued: the advisee is processing its own
    // in-flight tail turn or earlier FIFO steering messages. The advisor is
    // already activated (or restored) for the next snapshot, so do not count,
    // do not treat as an advisor turn, and do not change phase.
  }

  private async handleAdvisorTurnEnd(message: AssistantMessage): Promise<void> {
    const cycle = this.cycle;
    if (!cycle) return;

    if (message.stopReason === "error" || message.stopReason === "aborted") {
      await this.restoreAdvisee();
      this.deps.notify(
        "The advisor failed or was aborted. The advisee was restored and no continuation was sent.",
        "error",
      );
      this.phase = "idle";
      this.cycle = null;
      return;
    }

    if (message.stopReason === "toolUse") {
      // Advisor tool loop continues under the advisor.
      return;
    }

    // Final advisor response (stop / length). Require usable text.
    if (!assistantHasText(message)) {
      await this.restoreAdvisee();
      this.deps.notify(
        "The advisor produced no usable response. The advisee was restored.",
        "warning",
      );
      this.phase = "idle";
      this.cycle = null;
      return;
    }

    await this.restoreAdvisee();
    this.phase = "continuationQueued";
    this.deps.sendUserMessage(cycle.continuationPrompt, { deliverAs: "steer" });
  }

  private async handleAdviseeIdleTurnEnd(
    message: AssistantMessage,
  ): Promise<void> {
    const schedule = getSchedule();
    if (!schedule) return;
    if (schedule.sessionId !== this.deps.getSessionId()) {
      // Defensive: a schedule from a different session should not be counting here.
      clearSchedule();
      return;
    }
    // Classify by the assistant turn's recorded provider/model, not only by
    // mutable current context: an activation may have already changed
    // ctx.model to the advisor before this tail turn_end is observed.
    if (!this.isAdviseeTurn(message)) return;

    if (this.deps.hasPendingMessages()) {
      // Option B: defer automatic trigger until the FIFO queue is empty.
      // Saturate at the threshold so we trigger as soon as it drains, without
      // growing the counter while waiting.
      if (schedule.count < schedule.every) schedule.count = schedule.every;
      return;
    }

    schedule.count += 1;
    if (schedule.count >= schedule.every) {
      schedule.count = 0;
      await this.startCycle({
        tools: schedule.tools,
        context: schedule.context,
        source: "automatic",
      });
    }
  }

  /** Whether an assistant turn ran under the current advisee, by recorded metadata. */
  private isAdviseeTurn(message: AssistantMessage): boolean {
    const m = this.deps.getAdviseeModel();
    if (!m) return true; // cannot classify; be permissive
    return message.provider === m.provider && message.model === m.id;
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  onSessionStart(event: SessionStartEvent): void {
    const sessionId = this.deps.getSessionId();
    if (event.reason === "reload") {
      // Module-local state is fresh after re-evaluation; reset defensively.
      // The schedule survives reload only when it still belongs to this session.
      this.phase = "idle";
      this.cycle = null;
      const schedule = getSchedule();
      if (schedule && schedule.sessionId !== sessionId) {
        clearSchedule();
      }
      // Reloaded configuration is read fresh each cycle, but validate it now
      // so the user learns of a broken advisor config immediately after reload.
      const cfg = this.deps.loadConfig();
      if (!cfg.ok) {
        this.deps.notify(
          `Advisor configuration is invalid: ${cfg.error}`,
          "error",
        );
      }
      return;
    }
    // new / resume / fork / clone: clear the schedule and any local state.
    clearSchedule();
    this.phase = "idle";
    this.cycle = null;
  }

  async onSessionShutdown(event: SessionShutdownEvent): Promise<void> {
    if (event.reason === "reload") {
      return; // retain the schedule across idle reload
    }
    clearSchedule();
    // Defensive restore if a cycle was activated but never completed (e.g. the
    // run was aborted mid-cycle). Best-effort: the abort path normally restores.
    if (this.cycle?.snapshot) {
      try {
        await this.restoreAdvisee();
      } catch {
        // best-effort; do not throw out of a shutdown handler
      }
    }
    this.phase = "idle";
    this.cycle = null;
  }

  // ---------------------------------------------------------------------------
  // Test inspection seams
  // ---------------------------------------------------------------------------

  /** Current phase. Exposed for tests; not part of any user-facing surface. */
  getPhase(): Phase {
    return this.phase;
  }

  /** Whether a manual or automatic cycle is queued or active. Exposed for tests. */
  hasCycle(): boolean {
    return this.cycle !== null;
  }

  /** Current automatic schedule, or null. Exposed for tests by way of process-state. */
  currentSchedule(): AdviceSchedule | null {
    return getSchedule();
  }
}
