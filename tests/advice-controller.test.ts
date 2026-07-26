import { beforeEach, describe, expect, it } from "vitest";
import type {
  MessageStartEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

import {
  AdviceController,
  type AdviceDeps,
  type AdvisorModel,
} from "../src/advice-controller.js";
import type { ConfigResult } from "../src/config.js";
import { resetProcessState } from "../src/process-state.js";
import type { NotifyLevel, ThinkingLevel } from "../src/types.js";

const ADVISOR = {
  provider: "openai-codex",
  id: "gpt-5.6-sol",
} as unknown as AdvisorModel;
const ADVISEE = {
  provider: "anthropic",
  id: "claude-sonnet-4-5",
} as unknown as AdvisorModel;

interface SentMessage {
  content: string;
  deliverAs?: "steer";
}

/**
 * Runtime-faithful harness.
 *
 * `live` is mutable agent state (model/thinking/tools) changed by the deps
 * setters. `loop` is the snapshot captured for the NEXT assistant turn: it is
 * refreshed from `live` when a new run starts (an immediate sendUserMessage,
 * mirroring createContextSnapshot) and again after each awaited `turn_end`
 * handler (mirroring prepareNextTurn). An assistant turn therefore runs under
 * `loop`, and its recorded provider/model reflect `loop` at that moment — so a
 * turn whose recorded model differs from the (already-switched) live model is
 * classified correctly by controller phase, exactly as in Pi.
 */
class RuntimeHarness {
  live = {
    model: ADVISEE as AdvisorModel,
    thinking: "medium" as ThinkingLevel,
    tools: ["read", "bash", "edit", "write"],
  };
  loop = { ...this.live, tools: [...this.live.tools] };
  idle = true;
  userPending = 0;
  ourQueue: string[] = [];

  config: ConfigResult = {
    ok: true,
    config: {
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      thinkingLevel: "high",
    },
  };
  advisor: AdvisorModel | undefined = ADVISOR;
  hasAuthFlag = true;
  setModelResult = true;
  setModelAdviseeResult = true;
  sessionId = "sess-1";

  sent: SentMessage[] = [];
  setModelCalls: AdvisorModel[] = [];
  thinkingSet: ThinkingLevel[] = [];
  toolsSet: string[][] = [];
  notifies: { message: string; level: NotifyLevel }[] = [];

  controller!: AdviceController;

  reset(): void {
    resetProcessState();
    this.live = {
      model: ADVISEE,
      thinking: "medium",
      tools: ["read", "bash", "edit", "write"],
    };
    this.loop = { ...this.live, tools: [...this.live.tools] };
    this.idle = true;
    this.userPending = 0;
    this.ourQueue = [];
    this.config = {
      ok: true,
      config: {
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        thinkingLevel: "high",
      },
    };
    this.advisor = ADVISOR;
    this.hasAuthFlag = true;
    this.setModelResult = true;
    this.setModelAdviseeResult = true;
    this.sessionId = "sess-1";
    this.sent = [];
    this.setModelCalls = [];
    this.thinkingSet = [];
    this.toolsSet = [];
    this.notifies = [];
    this.controller = new AdviceController(this.deps);
  }

  get deps(): AdviceDeps {
    return {
      loadConfig: () => this.config,
      findAdvisor: (_p, _m) => this.advisor,
      hasAuth: () => this.hasAuthFlag,
      getAdviseeModel: () => this.live.model,
      getThinking: () => this.live.thinking,
      getActiveTools: () => [...this.live.tools],
      setModel: async (model) => {
        this.setModelCalls.push(model);
        const ok =
          model === ADVISOR ? this.setModelResult : this.setModelAdviseeResult;
        if (ok) this.live.model = model;
        return ok;
      },
      setThinking: (level) => {
        this.live.thinking = level;
        this.thinkingSet.push(level);
      },
      setActiveTools: (names) => {
        this.live.tools = [...names];
        this.toolsSet.push(names);
      },
      sendUserMessage: (content, opts) => {
        this.sent.push({ content, deliverAs: opts?.deliverAs });
        if (opts?.deliverAs === "steer") {
          this.ourQueue.push(content);
        } else {
          // A new run starts: snapshot live for the next turn (createContextSnapshot).
          this.loop = {
            model: this.live.model,
            thinking: this.live.thinking,
            tools: [...this.live.tools],
          };
          this.idle = false;
          this.ourQueue.push(content);
        }
      },
      isIdle: () => this.idle,
      hasPendingMessages: () => this.userPending > 0,
      notify: (message, level) => {
        this.notifies.push({ message, level });
      },
      getSessionId: () => this.sessionId,
    };
  }

  /** Deliver a user message (advisor prompt, continuation, or a user steer) to the controller. */
  async deliver(text: string): Promise<void> {
    await this.controller.onMessageStart(userStart(text));
  }

  /** Deliver the next prompt this extension queued (advisor or continuation). */
  async deliverNext(): Promise<void> {
    const text = this.ourQueue.shift();
    if (text === undefined)
      throw new Error("harness: nothing queued to deliver");
    await this.deliver(text);
  }

  /**
   * Run an assistant turn under the current `loop` snapshot, then refresh `loop`
   * from `live` (prepareNextTurn, after the awaited turn_end handler).
   */
  async runTurn(opts: {
    stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
    text?: string;
    provider?: string;
    model?: string;
  }): Promise<void> {
    const provider = opts.provider ?? this.loop.model.provider;
    const model = opts.model ?? this.loop.model.id;
    const text = opts.text ?? "ok";
    const ev = makeTurnEnd({
      provider,
      model,
      stopReason: opts.stopReason,
      text,
    });
    await this.controller.onTurnEnd(ev);
    this.loop = {
      model: this.live.model,
      thinking: this.live.thinking,
      tools: [...this.live.tools],
    };
  }

  lastNotify(): { message: string; level: NotifyLevel } | undefined {
    return this.notifies.at(-1);
  }

  /** Current controller phase, exposed for concise assertions. */
  getPhaseFromController():
    | "idle"
    | "adviceQueued"
    | "advisorActive"
    | "continuationQueued"
    | "adviseeContinuing" {
    return this.controller.getPhase();
  }
}

function setup(): RuntimeHarness {
  const h = new RuntimeHarness();
  h.reset();
  return h;
}

function userStart(text: string): MessageStartEvent {
  return {
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  } as unknown as MessageStartEvent;
}

interface TurnEndOpts {
  provider: string;
  model: string;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
  text: string;
}

function makeTurnEnd(opts: TurnEndOpts): TurnEndEvent {
  return {
    type: "turn_end",
    turnIndex: 0,
    message: {
      role: "assistant",
      content: opts.text === "" ? [] : [{ type: "text", text: opts.text }],
      provider: opts.provider,
      model: opts.model,
      stopReason: opts.stopReason,
      usage: {} as never,
      timestamp: Date.now(),
    },
    toolResults: [],
  } as unknown as TurnEndEvent;
}

describe("manual advice (idle)", () => {
  it("runs a tool-free cycle: activate advisor, restore advisee, continue", async () => {
    const h = setup();
    h.idle = true;
    h.live.thinking = "medium";
    h.live.tools = ["read", "bash"];

    await h.controller.handleAdvice("");
    // Activation happened before the advisor prompt was delivered.
    expect(h.setModelCalls).toEqual([ADVISOR]);
    expect(h.thinkingSet).toEqual(["high"]);
    expect(h.toolsSet).toEqual([[]]);
    expect(h.getPhaseFromController()).toBe("advisorActive");
    expect(h.sent[0].deliverAs).toBeUndefined();
    expect(h.sent[0].content).toContain("You are the advisor.");
    // loop snapshotted the advisor when the immediate run started.
    expect(h.loop.model).toBe(ADVISOR);

    await h.deliverNext(); // advisor prompt message_start (already advisorActive)
    expect(h.getPhaseFromController()).toBe("advisorActive");

    await h.runTurn({ stopReason: "stop", text: "try X" });
    expect(h.setModelCalls).toEqual([ADVISOR, ADVISEE]);
    expect(h.thinkingSet).toEqual(["high", "medium"]);
    expect(h.toolsSet).toEqual([[], ["read", "bash"]]);
    expect(h.sent[1].content).toContain("You are the advisee.");
    expect(h.sent[1].deliverAs).toBe("steer");
    expect(h.getPhaseFromController()).toBe("continuationQueued");

    await h.deliverNext();
    expect(h.getPhaseFromController()).toBe("adviseeContinuing");

    await h.runTurn({ stopReason: "stop", text: "doing it" });
    expect(h.getPhaseFromController()).toBe("idle");
    expect(h.controller.hasCycle()).toBe(false);
    // The continuation turn ran under the restored advisee.
    expect(h.loop.model).toBe(ADVISEE);
  });

  it("preserves the advisee tool set in tool-enabled mode", async () => {
    const h = setup();
    h.live.tools = ["read", "bash", "edit", "write"];
    await h.controller.handleAdvice("--tools inspect src");
    expect(h.getPhaseFromController()).toBe("advisorActive");
    expect(h.toolsSet[0]).toEqual(["read", "bash", "edit", "write"]);
    expect(h.sent[0].content).toContain(
      "investigate so your advice is grounded",
    );
  });

  it("rejects an overlapping request without sending", async () => {
    const h = setup();
    h.idle = true;
    await h.controller.handleAdvice("");
    expect(h.sent).toHaveLength(1);
    await h.controller.handleAdvice("");
    expect(h.sent).toHaveLength(1);
    expect(h.lastNotify()?.level).toBe("warning");
    expect(h.lastNotify()?.message).toMatch(/already active/);
  });
});

describe("manual advice (streaming) and FIFO boundary", () => {
  it("queues as steer and activates the advisor before delivery", async () => {
    const h = setup();
    h.idle = false; // advisee is streaming its in-flight turn
    h.loop = { ...h.live, tools: [...h.live.tools] }; // in-flight turn snapshotted as advisee

    await h.controller.handleAdvice("");
    expect(h.sent[0].deliverAs).toBe("steer");
    expect(h.getPhaseFromController()).toBe("adviceQueued");
    expect(h.setModelCalls).toEqual([ADVISOR]); // activated before queueing
    expect(h.thinkingSet).toEqual(["high"]);
    expect(h.toolsSet).toEqual([[]]);
    expect(h.ourQueue).toHaveLength(1);

    // The in-flight advisee turn finishes. It ran under the advisee (loop was
    // advisee even though live is now the advisor) and must NOT be treated as
    // an advisor turn or counted.
    expect(h.loop.model).toBe(ADVISEE);
    await h.runTurn({ stopReason: "stop", text: "advisee tail work" });
    expect(h.setModelCalls).toEqual([ADVISOR]); // no extra model switch
    expect(h.getPhaseFromController()).toBe("adviceQueued");
    expect(h.loop.model).toBe(ADVISOR); // prepareNextTurn snapshotted the advisor

    // Now the queued advisor prompt is delivered and the advisor runs.
    await h.deliverNext();
    expect(h.getPhaseFromController()).toBe("advisorActive");
    await h.runTurn({ stopReason: "stop", text: "advice" });
    expect(h.setModelCalls).toEqual([ADVISOR, ADVISEE]);
    expect(h.sent[1].deliverAs).toBe("steer");
    expect(h.getPhaseFromController()).toBe("continuationQueued");

    await h.deliverNext();
    expect(h.getPhaseFromController()).toBe("adviseeContinuing");
    await h.runTurn({ stopReason: "stop", text: "working" });
    expect(h.getPhaseFromController()).toBe("idle");
  });

  it("rejects manual advice while steering messages are pending (Option B)", async () => {
    const h = setup();
    h.idle = false;
    h.userPending = 1;

    await h.controller.handleAdvice("");
    expect(h.sent).toEqual([]);
    expect(h.setModelCalls).toEqual([]);
    expect(h.toolsSet).toEqual([]);
    expect(h.getPhaseFromController()).toBe("idle");
    expect(h.lastNotify()?.level).toBe("warning");
    expect(h.lastNotify()?.message).toMatch(/pending/);
  });

  it("does not count the in-flight advisee tail turn during a queued manual cycle", async () => {
    const h = setup();
    h.idle = false; // streaming
    h.loop = { ...h.live, tools: [...h.live.tools] };
    h.controller.handleAdviceEvery("2");
    await h.runTurn({ stopReason: "stop", text: "w1" }); // count 1

    await h.controller.handleAdvice(""); // streaming manual cycle; activates + queues
    expect(h.getPhaseFromController()).toBe("adviceQueued");

    // The in-flight advisee tail turn (recorded advisee, live advisor) is in
    // adviceQueued phase: it is neither counted nor treated as the advisor.
    await h.runTurn({
      stopReason: "stop",
      text: "tail",
      provider: ADVISEE.provider,
      model: ADVISEE.id,
    });
    expect(h.getPhaseFromController()).toBe("adviceQueued");
    expect(h.controller.currentSchedule()?.count).toBe(1); // unchanged
    expect(
      h.ourQueue.filter((m) => m.includes("You are the advisor.")),
    ).toHaveLength(1);
  });
});

describe("validation and failure paths", () => {
  it("rejects invalid configuration without any state change", async () => {
    const h = setup();
    h.config = { ok: false, error: "bad config" };
    await h.controller.handleAdvice("");
    expect(h.sent).toEqual([]);
    expect(h.setModelCalls).toEqual([]);
    expect(h.getPhaseFromController()).toBe("idle");
    expect(h.lastNotify()?.level).toBe("error");
  });

  it("rejects an unknown advisor model without sending", async () => {
    const h = setup();
    h.advisor = undefined;
    await h.controller.handleAdvice("");
    expect(h.sent).toEqual([]);
    expect(h.setModelCalls).toEqual([]);
    expect(h.lastNotify()?.message).toMatch(/not found/);
  });

  it("rejects an advisor with no auth without sending or switching", async () => {
    const h = setup();
    h.hasAuthFlag = false;
    await h.controller.handleAdvice("");
    expect(h.sent).toEqual([]);
    expect(h.setModelCalls).toEqual([]);
    expect(h.lastNotify()?.message).toMatch(/No API key/);
  });

  it("fails closed if the advisor switch is rejected at activation time", async () => {
    const h = setup();
    h.idle = true;
    h.setModelResult = false; // setModel(advisor) rejected (e.g. auth removed)
    await h.controller.handleAdvice("");
    expect(h.sent).toEqual([]);
    expect(h.setModelCalls).toEqual([ADVISOR]);
    expect(h.thinkingSet).toEqual([]); // never applied thinking/tools
    expect(h.toolsSet).toEqual([]);
    expect(h.getPhaseFromController()).toBe("idle");
    expect(h.lastNotify()?.level).toBe("error");
    expect(h.lastNotify()?.message).toMatch(/unavailable/);
  });

  it("keeps the advisor phase on a tool-use response", async () => {
    const h = setup();
    h.idle = true;
    await h.controller.handleAdvice("");
    await h.deliverNext();
    await h.runTurn({ stopReason: "toolUse" });
    expect(h.getPhaseFromController()).toBe("advisorActive");
    expect(h.setModelCalls).toEqual([ADVISOR]);
    expect(h.ourQueue).toHaveLength(0); // no continuation yet
  });

  it("restores the advisee without continuation on advisor error", async () => {
    const h = setup();
    h.idle = true;
    await h.controller.handleAdvice("");
    await h.deliverNext();
    await h.runTurn({ stopReason: "error" });
    expect(h.setModelCalls).toEqual([ADVISOR, ADVISEE]);
    expect(h.ourQueue).toHaveLength(0); // no continuation
    expect(h.getPhaseFromController()).toBe("idle");
    expect(h.lastNotify()?.level).toBe("error");
  });

  it("restores the advisee without continuation when the advisor produces no usable text", async () => {
    const h = setup();
    h.idle = true;
    await h.controller.handleAdvice("");
    await h.deliverNext();
    await h.runTurn({ stopReason: "stop", text: "" });
    expect(h.setModelCalls).toEqual([ADVISOR, ADVISEE]);
    expect(h.ourQueue).toHaveLength(0);
    expect(h.getPhaseFromController()).toBe("idle");
    expect(h.lastNotify()?.level).toBe("warning");
  });

  it("restoration runs once per cycle and does not double-switch", async () => {
    const h = setup();
    h.idle = true;
    await h.controller.handleAdvice("");
    await h.deliverNext();
    await h.runTurn({ stopReason: "stop", text: "ok" });
    expect(h.setModelCalls).toEqual([ADVISOR, ADVISEE]);
    // A stray second advisor turn_end cannot restore again: snapshot consumed.
    await h.runTurn({ stopReason: "stop", text: "stale" });
    expect(h.setModelCalls).toEqual([ADVISOR, ADVISEE]);
  });

  it("reports an advisee restoration failure without concealing it", async () => {
    const h = setup();
    h.idle = true;
    h.setModelAdviseeResult = false; // restore setModel(advisee) rejected
    await h.controller.handleAdvice("");
    await h.deliverNext();
    await h.runTurn({ stopReason: "stop", text: "ok" });
    expect(h.setModelCalls).toEqual([ADVISOR, ADVISEE]);
    expect(h.lastNotify()?.level).toBe("error");
    expect(h.lastNotify()?.message).toMatch(/Failed to restore the advisee/);
    // The cycle still sends a continuation (best-effort) despite the failure.
    expect(
      h.ourQueue.filter((m) => m.includes("You are the advisee.")),
    ).toHaveLength(1);
  });
});

describe("automatic cadence", () => {
  it("counts low-level advisee turns and triggers after the Nth", async () => {
    const h = setup();
    h.idle = false; // autonomous advisee streaming
    h.controller.handleAdviceEvery("2");
    expect(h.controller.currentSchedule()?.every).toBe(2);
    expect(h.controller.currentSchedule()?.count).toBe(0);

    await h.runTurn({ stopReason: "stop", text: "w1" });
    expect(h.controller.currentSchedule()?.count).toBe(1);
    expect(h.getPhaseFromController()).toBe("idle");

    await h.runTurn({ stopReason: "toolUse", text: "w2 with tools" });
    // Tool-calling advisee turns count too.
    expect(h.controller.currentSchedule()?.count).toBe(0); // reset at threshold
    expect(h.getPhaseFromController()).toBe("adviceQueued");
    expect(h.sent.at(-1)?.deliverAs).toBe("steer");

    // Run the advisor cycle (excluded from counting).
    await h.deliverNext();
    expect(h.getPhaseFromController()).toBe("advisorActive");
    await h.runTurn({ stopReason: "stop", text: "advice" });
    await h.deliverNext(); // continuation
    await h.runTurn({ stopReason: "stop", text: "continuing" });
    expect(h.getPhaseFromController()).toBe("idle");
    expect(h.controller.currentSchedule()?.count).toBe(0);

    // Subsequent autonomous advisee turns resume counting normally.
    await h.runTurn({ stopReason: "stop", text: "w3" });
    expect(h.controller.currentSchedule()?.count).toBe(1);
  });

  it("does not count an idle-phase turn whose recorded model is the advisor", async () => {
    const h = setup();
    h.idle = false;
    h.controller.handleAdviceEvery("3");
    // An idle-phase turn with advisor recorded metadata but advisee live state
    // is not counted (metadata-based classification, not ctx.model).
    await h.runTurn({
      stopReason: "stop",
      text: "stale",
      provider: ADVISOR.provider,
      model: ADVISOR.id,
    });
    expect(h.controller.currentSchedule()?.count).toBe(0);
    await h.runTurn({ stopReason: "stop", text: "real advisee work" });
    expect(h.controller.currentSchedule()?.count).toBe(1);
  });

  it("defers an automatic trigger while steering messages are pending (Option B)", async () => {
    const h = setup();
    h.idle = false;
    h.controller.handleAdviceEvery("2");
    await h.runTurn({ stopReason: "stop", text: "w1" });
    expect(h.controller.currentSchedule()?.count).toBe(1);

    h.userPending = 1; // user steering messages are queued
    await h.runTurn({ stopReason: "stop", text: "w2" });
    // No trigger; counter saturates at the threshold; phase stays idle.
    expect(h.getPhaseFromController()).toBe("idle");
    expect(h.ourQueue).toHaveLength(0);
    expect(h.setModelCalls).toEqual([]);
    expect(h.controller.currentSchedule()?.count).toBe(2); // saturated at threshold

    h.userPending = 0; // queue drained
    await h.runTurn({ stopReason: "stop", text: "w3" });
    expect(h.getPhaseFromController()).toBe("adviceQueued");
    expect(h.sent.at(-1)?.deliverAs).toBe("steer");
  });

  it("off clears the schedule", () => {
    const h = setup();
    h.controller.handleAdviceEvery("5");
    expect(h.controller.currentSchedule()).not.toBeNull();
    h.controller.handleAdviceEvery("off");
    expect(h.controller.currentSchedule()).toBeNull();
  });

  it("reconfiguration resets the counter and schedule fields", async () => {
    const h = setup();
    h.controller.handleAdviceEvery("3");
    await h.runTurn({ stopReason: "stop", text: "w" });
    await h.runTurn({ stopReason: "stop", text: "w" });
    expect(h.controller.currentSchedule()?.count).toBe(2);
    h.controller.handleAdviceEvery("5 --tools focus on risks");
    expect(h.controller.currentSchedule()?.every).toBe(5);
    expect(h.controller.currentSchedule()?.tools).toBe(true);
    expect(h.controller.currentSchedule()?.context).toBe("focus on risks");
    expect(h.controller.currentSchedule()?.count).toBe(0);
  });

  it("manual advice does not reset the automatic counter", async () => {
    const h = setup();
    h.idle = false;
    h.controller.handleAdviceEvery("3");
    await h.runTurn({ stopReason: "stop", text: "w1" });
    expect(h.controller.currentSchedule()?.count).toBe(1);

    // Run a complete manual cycle (idle manual): switch to idle for the command.
    h.idle = true;
    await h.controller.handleAdvice("");
    await h.deliverNext();
    await h.runTurn({ stopReason: "stop", text: "advice" });
    await h.deliverNext();
    // continuation turn happens while "streaming" again
    await h.runTurn({ stopReason: "stop", text: "continuing" });
    expect(h.getPhaseFromController()).toBe("idle");

    // Counter untouched by the manual cycle; two more turns trigger auto advice.
    expect(h.controller.currentSchedule()?.count).toBe(1);
    h.idle = false;
    await h.runTurn({ stopReason: "stop", text: "w2" });
    expect(h.controller.currentSchedule()?.count).toBe(2);
    await h.runTurn({ stopReason: "stop", text: "w3" });
    expect(h.controller.currentSchedule()?.count).toBe(0);
    expect(h.getPhaseFromController()).toBe("adviceQueued");
  });

  it("failed automatic advice waits a full new interval before retrying", async () => {
    const h = setup();
    h.idle = false;
    h.controller.handleAdviceEvery("2");
    await h.runTurn({ stopReason: "stop", text: "w1" }); // count 1
    // Make the advisor config invalid for the first automatic attempt.
    h.config = { ok: false, error: "broken" };
    await h.runTurn({ stopReason: "stop", text: "w2" }); // threshold -> fail -> count 0
    expect(h.getPhaseFromController()).toBe("idle");
    expect(h.controller.currentSchedule()?.count).toBe(0);
    await h.runTurn({ stopReason: "stop", text: "w3" }); // not enough
    expect(h.getPhaseFromController()).toBe("idle");
    expect(h.controller.currentSchedule()?.count).toBe(1);
    // Restore a valid config; the next threshold turn triggers again.
    h.config = {
      ok: true,
      config: {
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        thinkingLevel: "high",
      },
    };
    await h.runTurn({ stopReason: "stop", text: "w4" });
    expect(h.getPhaseFromController()).toBe("adviceQueued");
  });
});

describe("queued user messages during a cycle", () => {
  it("lets a user steer run under the restored advisee between advisor and continuation, without losing the continuation", async () => {
    const h = setup();
    h.idle = false;
    h.loop = { ...h.live, tools: [...h.live.tools] };
    await h.controller.handleAdvice("");

    // In-flight advisee tail turn finishes; advisor prompt drains next.
    await h.runTurn({
      stopReason: "stop",
      text: "tail",
      provider: ADVISEE.provider,
      model: ADVISEE.id,
    });
    await h.deliverNext(); // advisor prompt
    expect(h.getPhaseFromController()).toBe("advisorActive");

    // A user steer is queued during the advisor turn, before it finishes.
    h.userPending = 1;
    await h.runTurn({ stopReason: "stop", text: "advisor advice" });
    // Advisor finished: advisee restored, continuation queued (as steer).
    expect(h.getPhaseFromController()).toBe("continuationQueued");
    expect(h.loop.model).toBe(ADVISEE); // restore happened before next-turn snapshot

    // The user's earlier steer drains and runs under the restored advisee;
    // it is not our continuation, so the cycle phase is unchanged.
    await h.deliver("do this other thing first");
    expect(h.getPhaseFromController()).toBe("continuationQueued");
    await h.runTurn({ stopReason: "stop", text: "did the other thing" });
    expect(h.getPhaseFromController()).toBe("continuationQueued");

    // The continuation is still queued and runs afterward, completing the cycle.
    await h.deliverNext();
    expect(h.getPhaseFromController()).toBe("adviseeContinuing");
    await h.runTurn({ stopReason: "stop", text: "continuing the work" });
    expect(h.getPhaseFromController()).toBe("idle");
  });
});

describe("session lifecycle", () => {
  it("retains the schedule across idle reload and validates reloaded config", () => {
    const h = setup();
    h.controller.handleAdviceEvery("3");
    h.controller.onSessionShutdown({
      type: "session_shutdown",
      reason: "reload",
    } as unknown as SessionShutdownEvent);
    expect(h.controller.currentSchedule()).not.toBeNull();
    h.config = {
      ok: true,
      config: {
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        thinkingLevel: "high",
      },
    };
    h.controller.onSessionStart({
      type: "session_start",
      reason: "reload",
    } as unknown as SessionStartEvent);
    expect(h.controller.currentSchedule()?.every).toBe(3);
  });

  it("notifies on invalid config after reload", () => {
    const h = setup();
    h.controller.handleAdviceEvery("3");
    h.config = { ok: false, error: "global: missing provider" };
    h.controller.onSessionStart({
      type: "session_start",
      reason: "reload",
    } as unknown as SessionStartEvent);
    expect(h.lastNotify()?.level).toBe("error");
    expect(h.lastNotify()?.message).toMatch(/invalid/);
  });

  it("clears the schedule on reload when the session id differs", () => {
    const h = setup();
    h.controller.handleAdviceEvery("3");
    h.sessionId = "sess-2";
    h.controller.onSessionStart({
      type: "session_start",
      reason: "reload",
    } as unknown as SessionStartEvent);
    expect(h.controller.currentSchedule()).toBeNull();
  });

  it("clears the schedule and current cycle on new/resume/fork/restores defensively", async () => {
    const h = setup();
    h.controller.handleAdviceEvery("3");
    h.idle = true;
    await h.controller.handleAdvice("");
    expect(h.controller.hasCycle()).toBe(true);
    h.controller.onSessionStart({
      type: "session_start",
      reason: "new",
    } as unknown as SessionStartEvent);
    expect(h.controller.currentSchedule()).toBeNull();
    expect(h.getPhaseFromController()).toBe("idle");
    expect(h.controller.hasCycle()).toBe(false);
  });

  it("defensively restores the advisee on a non-reload shutdown mid-cycle", async () => {
    const h = setup();
    h.idle = true;
    await h.controller.handleAdvice(""); // advisor activated, snapshot present
    expect(h.setModelCalls).toEqual([ADVISOR]);
    await h.controller.onSessionShutdown({
      type: "session_shutdown",
      reason: "quit",
    } as unknown as SessionShutdownEvent);
    expect(h.setModelCalls).toEqual([ADVISOR, ADVISEE]); // defensive restore
    expect(h.controller.currentSchedule()).toBeNull();
    expect(h.getPhaseFromController()).toBe("idle");
  });

  it("clears the schedule on a non-reload shutdown without an active cycle", () => {
    const h = setup();
    h.controller.handleAdviceEvery("3");
    h.controller.onSessionShutdown({
      type: "session_shutdown",
      reason: "quit",
    } as unknown as SessionShutdownEvent);
    expect(h.controller.currentSchedule()).toBeNull();
  });
});
