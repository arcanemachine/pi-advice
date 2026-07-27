import type {
  MessageStartEvent,
  ModelRegistry,
  SessionShutdownEvent,
  SessionStartEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

import { parseAdvise, parseAdviseEvery } from "./command.js";
import type { ConfigResult } from "./config.js";
import {
  clearSchedule,
  getSchedule,
  setSchedule,
  type AdviceSchedule,
} from "./process-state.js";
import { buildAdvisePrompt, buildContinuationPrompt } from "./prompts.js";
import type { NotifyLevel, ThinkingLevel } from "./types.js";

/** Advisor model object, derived from Pi's public model registry. */
export type AdvisorModel = NonNullable<ReturnType<ModelRegistry["find"]>>;

export const REVIEW_MESSAGE_TYPE = "pi-advice.review.v1";
export const CONTINUATION_MESSAGE_TYPE = "pi-advice.continue.v1";
export const ADVISOR_WORKING_MESSAGE = "Advising... 🧠 ";

export type Phase =
  | "idle"
  | "adviceQueued"
  | "advisorActive"
  | "continuationQueued"
  | "adviseeContinuing";

interface AdviceSnapshot {
  model: AdvisorModel;
  thinking: ThinkingLevel;
  tools: string[];
}

interface AdviceCycle {
  advisorModel: AdvisorModel;
  thinkingLevel: ThinkingLevel;
  tools: boolean;
  advisorPrompt: string;
  continuationPrompt: string;
  snapshot: AdviceSnapshot | null;
}

export interface HiddenMessage {
  customType: string;
  content: string;
  display: false;
}

export interface HiddenMessageOptions {
  triggerTurn: true;
  deliverAs: "steer";
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

  sendMessage(message: HiddenMessage, options: HiddenMessageOptions): void;

  isIdle(): boolean;
  hasPendingMessages(): boolean;

  notify(message: string, level: NotifyLevel): void;
  setWorkingMessage(message?: string): void;
  getSessionId(): string;
}

const OVERLAP_MESSAGE =
  "An advice cycle is already active. Wait for it to finish before requesting another.";
const PENDING_MESSAGE =
  "Advice cannot start while other steering messages are pending. Wait for them to finish, then retry /advise.";
const PENDING_RACE_MESSAGE =
  "Advice was cancelled because another steering message arrived. Wait for it to finish, then retry /advise.";

const HIDDEN_DELIVERY: HiddenMessageOptions = {
  triggerTurn: true,
  deliverAs: "steer",
};

type AssistantMessage = Extract<TurnEndEvent["message"], { role: "assistant" }>;
type CycleSource = "manual" | "automatic";
type StartOutcome = "started" | "failed" | "deferred";

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

function assistantHasText(message: AssistantMessage): boolean {
  return message.content.some(
    (part) => part.type === "text" && part.text.trim() !== "",
  );
}

function sameModel(
  left: AdvisorModel | undefined,
  right: AdvisorModel | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.provider === right.provider &&
    left.id === right.id
  );
}

export class AdviceController {
  private phase: Phase = "idle";
  private cycle: AdviceCycle | null = null;
  private ownsWorkingMessage = false;

  constructor(private readonly deps: AdviceDeps) {}

  private showAdvisorWorking(): void {
    if (this.ownsWorkingMessage) return;
    this.deps.setWorkingMessage(ADVISOR_WORKING_MESSAGE);
    this.ownsWorkingMessage = true;
  }

  private clearAdvisorWorking(): void {
    if (!this.ownsWorkingMessage) return;
    this.deps.setWorkingMessage();
    this.ownsWorkingMessage = false;
  }

  /** `/advise` command body. */
  async handleAdvise(args: string): Promise<void> {
    const parsed = parseAdvise(args);
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

  /** `/advise-every` command body. */
  handleAdviseEvery(args: string): void {
    const parsed = parseAdviseEvery(args);
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

  private async startCycle(input: {
    tools: boolean;
    context: string;
    source: CycleSource;
  }): Promise<StartOutcome> {
    const config = this.deps.loadConfig();
    if (!config.ok) {
      this.deps.notify(
        `Advisor configuration is invalid: ${config.error}`,
        "error",
      );
      return "failed";
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
      return "failed";
    }
    if (!this.deps.hasAuth(advisor)) {
      this.deps.notify(
        `No API key configured for ${config.config.provider}. Run /login ${config.config.provider} to authenticate.`,
        "error",
      );
      return "failed";
    }

    const originalModel = this.deps.getAdviseeModel();
    if (!originalModel) {
      this.deps.notify(
        "Advice cannot start without an active model to restore.",
        "error",
      );
      return "failed";
    }

    const focus = input.context.trim();
    this.cycle = {
      advisorModel: advisor,
      thinkingLevel: config.config.thinkingLevel,
      tools: input.tools,
      advisorPrompt: buildAdvisePrompt({ tools: input.tools, context: focus }),
      continuationPrompt: buildContinuationPrompt(),
      snapshot: {
        model: originalModel,
        thinking: this.deps.getThinking(),
        tools: this.deps.getActiveTools(),
      },
    };
    this.phase = "adviceQueued";

    const activated = await this.activateAdvisor();
    if (!activated) return "failed";

    if (this.deps.hasPendingMessages()) {
      const restored = await this.restoreAdvisee();
      this.phase = "idle";
      this.cycle = null;
      if (!restored) return "failed";
      if (input.source === "manual") {
        this.deps.notify(PENDING_RACE_MESSAGE, "warning");
      }
      return "deferred";
    }

    const wasIdle = this.deps.isIdle();
    this.phase = wasIdle ? "advisorActive" : "adviceQueued";
    this.deps.notify(
      focus === "" ? "Advising..." : `Advising: ${focus}`,
      "info",
    );

    try {
      this.deps.sendMessage(
        {
          customType: REVIEW_MESSAGE_TYPE,
          content: this.cycle.advisorPrompt,
          display: false,
        },
        HIDDEN_DELIVERY,
      );
    } catch (error) {
      const restored = await this.restoreAdvisee();
      this.phase = "idle";
      this.cycle = null;
      this.deps.notify(
        `Unable to queue reconsideration: ${describe(error)}${restored ? "" : " Original state could not be fully restored."}`,
        "error",
      );
      return "failed";
    }

    return "started";
  }

  private async activateAdvisor(): Promise<boolean> {
    const cycle = this.cycle;
    if (!cycle?.snapshot) return false;

    try {
      const ok = await this.deps.setModel(cycle.advisorModel);
      if (!ok) {
        const changed = sameModel(
          this.deps.getAdviseeModel(),
          cycle.advisorModel,
        );
        if (changed) await this.restoreAdvisee();
        else cycle.snapshot = null;
        const label = `${cycle.advisorModel.provider}/${cycle.advisorModel.id}`;
        this.phase = "idle";
        this.cycle = null;
        this.deps.notify(
          `Advisor ${label} is unavailable; no advice was given.`,
          "error",
        );
        return false;
      }

      this.deps.setThinking(cycle.thinkingLevel);
      this.deps.setActiveTools(cycle.tools ? cycle.snapshot.tools : []);
      return true;
    } catch (error) {
      const restored = await this.restoreAdvisee();
      const label = `${cycle.advisorModel.provider}/${cycle.advisorModel.id}`;
      this.phase = "idle";
      this.cycle = null;
      this.deps.notify(
        `Failed to activate advisor ${label}: ${describe(error)}${restored ? "" : " Original state could not be fully restored."}`,
        "error",
      );
      return false;
    }
  }

  /** Restore the exact model, thinking level, and active tool names once. */
  private async restoreAdvisee(): Promise<boolean> {
    const cycle = this.cycle;
    if (!cycle?.snapshot) return true;

    const snapshot = cycle.snapshot;
    let modelRestored = false;
    let thinkingRestored = true;
    let toolsRestored = true;

    try {
      const ok = await this.deps.setModel(snapshot.model);
      modelRestored =
        ok || sameModel(this.deps.getAdviseeModel(), snapshot.model);
    } catch {
      modelRestored = sameModel(this.deps.getAdviseeModel(), snapshot.model);
    }

    try {
      this.deps.setThinking(snapshot.thinking);
    } catch {
      thinkingRestored = false;
    }
    try {
      this.deps.setActiveTools(snapshot.tools);
    } catch {
      toolsRestored = false;
    }

    cycle.snapshot = null;
    const restored = modelRestored && thinkingRestored && toolsRestored;
    if (!restored) {
      clearSchedule();
      const label = `${snapshot.model.provider}/${snapshot.model.id}`;
      this.deps.notify(
        `Failed to restore the original state for ${label}. Select that model manually with /model before requesting more advice. Automatic advice was disabled.`,
        "error",
      );
    }
    return restored;
  }

  async onMessageStart(event: MessageStartEvent): Promise<void> {
    const message = event.message;
    if (message.role !== "custom") return;
    const text = messageText(message.content);

    if (
      (this.phase === "adviceQueued" || this.phase === "advisorActive") &&
      this.cycle &&
      message.customType === REVIEW_MESSAGE_TYPE &&
      text === this.cycle.advisorPrompt
    ) {
      this.phase = "advisorActive";
      this.showAdvisorWorking();
      return;
    }
    if (
      this.phase === "continuationQueued" &&
      this.cycle &&
      message.customType === CONTINUATION_MESSAGE_TYPE &&
      text === this.cycle.continuationPrompt
    ) {
      this.phase = "adviseeContinuing";
    }
  }

  async onTurnEnd(event: TurnEndEvent): Promise<void> {
    const message = event.message;
    if (message.role !== "assistant") return;

    if (this.phase === "advisorActive") {
      await this.handleAdvisorTurnEnd(message as AssistantMessage);
      return;
    }
    if (this.phase === "adviseeContinuing") {
      this.phase = "idle";
      this.cycle = null;
      return;
    }
    if (this.phase === "idle") {
      await this.handleAdviseeIdleTurnEnd(message as AssistantMessage);
    }
  }

  private async handleAdvisorTurnEnd(message: AssistantMessage): Promise<void> {
    const cycle = this.cycle;
    if (!cycle) return;

    if (message.stopReason === "error" || message.stopReason === "aborted") {
      this.clearAdvisorWorking();
      const restored = await this.restoreAdvisee();
      if (restored) {
        this.deps.notify(
          "The reconsideration failed or was aborted. Original state was restored; no continuation was sent.",
          "error",
        );
      }
      this.phase = "idle";
      this.cycle = null;
      return;
    }

    if (message.stopReason === "toolUse" && cycle.tools) {
      return;
    }

    if (!assistantHasText(message)) {
      this.clearAdvisorWorking();
      const restored = await this.restoreAdvisee();
      if (restored) {
        this.deps.notify(
          "The reconsideration produced no usable response. Original state was restored.",
          "warning",
        );
      }
      this.phase = "idle";
      this.cycle = null;
      return;
    }

    this.clearAdvisorWorking();
    const restored = await this.restoreAdvisee();
    if (!restored) {
      this.phase = "idle";
      this.cycle = null;
      return;
    }

    this.phase = "continuationQueued";
    try {
      this.deps.sendMessage(
        {
          customType: CONTINUATION_MESSAGE_TYPE,
          content: cycle.continuationPrompt,
          display: false,
        },
        HIDDEN_DELIVERY,
      );
    } catch (error) {
      this.deps.notify(
        `Unable to queue continuation: ${describe(error)}`,
        "error",
      );
      this.phase = "idle";
      this.cycle = null;
    }
  }

  private async handleAdviseeIdleTurnEnd(
    message: AssistantMessage,
  ): Promise<void> {
    const schedule = getSchedule();
    if (!schedule) return;
    if (schedule.sessionId !== this.deps.getSessionId()) {
      clearSchedule();
      return;
    }
    if (!this.isAdviseeTurn(message)) return;

    if (schedule.count < schedule.every) schedule.count += 1;
    if (schedule.count < schedule.every) return;
    schedule.count = schedule.every;

    if (this.deps.hasPendingMessages()) return;

    schedule.count = 0;
    const outcome = await this.startCycle({
      tools: schedule.tools,
      context: schedule.context,
      source: "automatic",
    });
    if (outcome === "deferred") {
      const current = getSchedule();
      if (current === schedule) current.count = current.every;
    }
  }

  private isAdviseeTurn(message: AssistantMessage): boolean {
    const model = this.deps.getAdviseeModel();
    if (!model) return true;
    return message.provider === model.provider && message.model === model.id;
  }

  onSessionStart(event: SessionStartEvent): void {
    this.clearAdvisorWorking();
    const sessionId = this.deps.getSessionId();
    if (event.reason === "reload") {
      this.phase = "idle";
      this.cycle = null;
      const schedule = getSchedule();
      if (schedule && schedule.sessionId !== sessionId) clearSchedule();
      const config = this.deps.loadConfig();
      if (!config.ok) {
        this.deps.notify(
          `Advisor configuration is invalid: ${config.error}`,
          "error",
        );
      }
      return;
    }

    clearSchedule();
    this.phase = "idle";
    this.cycle = null;
  }

  async onSessionShutdown(event: SessionShutdownEvent): Promise<void> {
    this.clearAdvisorWorking();
    if (event.reason === "reload") return;

    clearSchedule();
    if (this.cycle?.snapshot) {
      try {
        await this.restoreAdvisee();
      } catch {
        // Shutdown restoration is best-effort after ordinary cycle paths handled it.
      }
    }
    this.phase = "idle";
    this.cycle = null;
  }

  getPhase(): Phase {
    return this.phase;
  }

  hasCycle(): boolean {
    return this.cycle !== null;
  }

  currentSchedule(): AdviceSchedule | null {
    return getSchedule();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
