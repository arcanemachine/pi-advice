import type {
  MessageStartEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ADVISOR_WORKING_MESSAGE,
  AdviceController,
  CONTINUATION_MESSAGE_TYPE,
  REVIEW_MESSAGE_TYPE,
  type AdviceDeps,
  type AdvisorModel,
  type HiddenMessage,
  type HiddenMessageOptions,
  type Phase,
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

type SwitchBehavior = "ok" | "false" | "throw" | "mutate-throw";

interface SentMessage {
  message: HiddenMessage;
  options: HiddenMessageOptions;
}

class RuntimeHarness {
  live = {
    model: ADVISEE as AdvisorModel,
    thinking: "medium" as ThinkingLevel,
    tools: ["read", "bash", "edit", "write"],
  };
  loop = { ...this.live, tools: [...this.live.tools] };
  idle = true;
  userPending = 0;
  customQueue: HiddenMessage[] = [];

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
  advisorSwitch: SwitchBehavior = "ok";
  adviseeSwitch: SwitchBehavior = "ok";
  afterAdvisorSwitch: (() => void) | undefined;
  sessionId = "sess-1";

  sent: SentMessage[] = [];
  setModelCalls: AdvisorModel[] = [];
  thinkingSet: ThinkingLevel[] = [];
  toolsSet: string[][] = [];
  notifies: { message: string; level: NotifyLevel }[] = [];
  workingMessages: Array<string | undefined> = [];
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
    this.customQueue = [];
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
    this.advisorSwitch = "ok";
    this.adviseeSwitch = "ok";
    this.afterAdvisorSwitch = undefined;
    this.sessionId = "sess-1";
    this.sent = [];
    this.setModelCalls = [];
    this.thinkingSet = [];
    this.toolsSet = [];
    this.notifies = [];
    this.workingMessages = [];
    this.controller = new AdviceController(this.deps);
  }

  get deps(): AdviceDeps {
    return {
      loadConfig: () => this.config,
      findAdvisor: () => this.advisor,
      hasAuth: () => this.hasAuthFlag,
      getAdviseeModel: () => this.live.model,
      getThinking: () => this.live.thinking,
      getActiveTools: () => [...this.live.tools],
      setModel: async (model) => {
        this.setModelCalls.push(model);
        const behavior =
          model === ADVISOR ? this.advisorSwitch : this.adviseeSwitch;
        if (behavior === "ok") this.live.model = model;
        if (behavior === "mutate-throw") {
          this.live.model = model;
          throw new Error("switch exploded after mutation");
        }
        if (behavior === "throw") throw new Error("switch exploded");
        if (model === ADVISOR) this.afterAdvisorSwitch?.();
        return behavior === "ok";
      },
      setThinking: (level) => {
        this.live.thinking = level;
        this.thinkingSet.push(level);
      },
      setActiveTools: (names) => {
        this.live.tools = [...names];
        this.toolsSet.push([...names]);
      },
      sendMessage: (message, options) => {
        this.sent.push({ message, options });
        this.customQueue.push(message);
        if (this.idle && options.triggerTurn) {
          this.loop = {
            model: this.live.model,
            thinking: this.live.thinking,
            tools: [...this.live.tools],
          };
          this.idle = false;
        }
      },
      isIdle: () => this.idle,
      hasPendingMessages: () => this.userPending > 0,
      notify: (message, level) => this.notifies.push({ message, level }),
      setWorkingMessage: (message) => this.workingMessages.push(message),
      getSessionId: () => this.sessionId,
    };
  }

  async deliverNext(): Promise<HiddenMessage> {
    const message = this.customQueue.shift();
    if (!message) throw new Error("harness: no custom message queued");
    await this.controller.onMessageStart(customStart(message));
    return message;
  }

  async deliverUser(text: string): Promise<void> {
    await this.controller.onMessageStart(userStart(text));
  }

  async runTurn(options: {
    stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
    text?: string;
    provider?: string;
    model?: string;
  }): Promise<void> {
    await this.controller.onTurnEnd(
      makeTurnEnd({
        provider: options.provider ?? this.loop.model.provider,
        model: options.model ?? this.loop.model.id,
        stopReason: options.stopReason,
        text: options.text ?? "ok",
      }),
    );
    this.loop = {
      model: this.live.model,
      thinking: this.live.thinking,
      tools: [...this.live.tools],
    };
  }

  lastNotify(): { message: string; level: NotifyLevel } | undefined {
    return this.notifies.at(-1);
  }

  phase(): Phase {
    return this.controller.getPhase();
  }
}

function setup(): RuntimeHarness {
  const harness = new RuntimeHarness();
  harness.reset();
  return harness;
}

function customStart(message: HiddenMessage): MessageStartEvent {
  return {
    type: "message_start",
    message: {
      role: "custom",
      customType: message.customType,
      content: message.content,
      display: message.display,
      timestamp: Date.now(),
    },
  } as unknown as MessageStartEvent;
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

function makeTurnEnd(options: {
  provider: string;
  model: string;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
  text: string;
}): TurnEndEvent {
  return {
    type: "turn_end",
    turnIndex: 0,
    message: {
      role: "assistant",
      content:
        options.text === "" ? [] : [{ type: "text", text: options.text }],
      provider: options.provider,
      model: options.model,
      stopReason: options.stopReason,
      usage: {} as never,
      timestamp: Date.now(),
    },
    toolResults: [],
  } as unknown as TurnEndEvent;
}

beforeEach(() => resetProcessState());

describe("manual /advise", () => {
  it("runs an idle tool-free cycle with hidden messages and exact notification", async () => {
    const harness = setup();
    harness.live.tools = ["read", "bash"];

    await harness.controller.handleAdvise("");

    expect(harness.setModelCalls).toEqual([ADVISOR]);
    expect(harness.thinkingSet).toEqual(["high"]);
    expect(harness.toolsSet).toEqual([[]]);
    expect(harness.phase()).toBe("advisorActive");
    expect(harness.loop.model).toBe(ADVISOR);
    expect(harness.workingMessages).toEqual([]);
    expect(harness.notifies).toEqual([]);
    expect(harness.sent[0]).toEqual({
      message: {
        customType: REVIEW_MESSAGE_TYPE,
        content: expect.any(String),
        display: false,
      },
      options: { triggerTurn: true, deliverAs: "steer" },
    });

    const review = await harness.deliverNext();
    expect(review.content).toContain("Recommended next action(s):");
    expect(harness.workingMessages).toEqual([ADVISOR_WORKING_MESSAGE]);
    expect(ADVISOR_WORKING_MESSAGE.endsWith(" ")).toBe(true);
    await harness.runTurn({ stopReason: "stop", text: "I just realized X." });

    expect(harness.workingMessages).toEqual([
      ADVISOR_WORKING_MESSAGE,
      undefined,
    ]);
    expect(harness.setModelCalls).toEqual([ADVISOR, ADVISEE]);
    expect(harness.thinkingSet).toEqual(["high", "medium"]);
    expect(harness.toolsSet).toEqual([[], ["read", "bash"]]);
    expect(harness.phase()).toBe("continuationQueued");
    expect(harness.sent[1]).toEqual({
      message: {
        customType: CONTINUATION_MESSAGE_TYPE,
        content: expect.any(String),
        display: false,
      },
      options: { triggerTurn: true, deliverAs: "steer" },
    });

    await harness.deliverNext();
    expect(harness.phase()).toBe("adviseeContinuing");
    await harness.runTurn({ stopReason: "stop", text: "acting on it" });
    expect(harness.phase()).toBe("idle");
    expect(harness.controller.hasCycle()).toBe(false);
    expect(harness.loop.model).toBe(ADVISEE);
  });

  it("passes trimmed focus only to the hidden review prompt", async () => {
    const harness = setup();
    await harness.controller.handleAdvise("  focus on the race  ");
    expect(harness.notifies).toEqual([]);
    expect(harness.sent[0]?.message.content).toContain(
      "Focus for this reconsideration:\nfocus on the race",
    );
  });

  it("preserves the exact active tools only with --tools", async () => {
    const harness = setup();
    await harness.controller.handleAdvise("--tools inspect src");
    expect(harness.toolsSet[0]).toEqual(["read", "bash", "edit", "write"]);
    expect(harness.sent[0]?.message.content).toContain(
      "minimum reasonable number of tool calls",
    );
  });

  it("rejects overlap", async () => {
    const harness = setup();
    await harness.controller.handleAdvise("");
    await harness.controller.handleAdvise("");
    expect(harness.sent).toHaveLength(1);
    expect(harness.lastNotify()?.message).toMatch(/already active/);
  });

  it("rejects initial pending steering without activation or notification", async () => {
    const harness = setup();
    harness.userPending = 1;
    await harness.controller.handleAdvise("");
    expect(harness.sent).toEqual([]);
    expect(harness.setModelCalls).toEqual([]);
    expect(harness.notifies).toHaveLength(1);
    expect(harness.lastNotify()?.message).toContain("/advise");
  });

  it("rechecks pending steering after async activation and restores", async () => {
    const harness = setup();
    harness.afterAdvisorSwitch = () => {
      harness.userPending = 1;
    };
    await harness.controller.handleAdvise("focus");
    expect(harness.setModelCalls).toEqual([ADVISOR, ADVISEE]);
    expect(harness.sent).toEqual([]);
    expect(harness.phase()).toBe("idle");
    expect(harness.notifies).toHaveLength(1);
    expect(harness.lastNotify()?.message).toMatch(/cancelled/);
  });
});

describe("streaming and snapshot boundary", () => {
  it("activates before queueing while the frozen tail turn remains original", async () => {
    const harness = setup();
    harness.idle = false;
    harness.loop = { ...harness.live, tools: [...harness.live.tools] };

    await harness.controller.handleAdvise("");
    expect(harness.phase()).toBe("adviceQueued");
    expect(harness.setModelCalls).toEqual([ADVISOR]);
    expect(harness.loop.model).toBe(ADVISEE);

    await harness.runTurn({ stopReason: "stop", text: "tail" });
    expect(harness.phase()).toBe("adviceQueued");
    expect(harness.loop.model).toBe(ADVISOR);
    expect(harness.workingMessages).toEqual([]);

    await harness.deliverNext();
    expect(harness.phase()).toBe("advisorActive");
    expect(harness.workingMessages).toEqual([ADVISOR_WORKING_MESSAGE]);
    await harness.runTurn({ stopReason: "stop", text: "realization" });
    expect(harness.loop.model).toBe(ADVISEE);
    expect(harness.phase()).toBe("continuationQueued");
  });

  it("requires exact custom type and content to transition queued phases", async () => {
    const harness = setup();
    harness.idle = false;
    await harness.controller.handleAdvise("");
    const actual = harness.customQueue[0]!;

    await harness.controller.onMessageStart(
      customStart({ ...actual, customType: "some-other-extension" }),
    );
    expect(harness.phase()).toBe("adviceQueued");
    await harness.controller.onMessageStart(
      customStart({ ...actual, content: `${actual.content} altered` }),
    );
    expect(harness.phase()).toBe("adviceQueued");
    await harness.deliverNext();
    expect(harness.phase()).toBe("advisorActive");
    await harness.controller.onMessageStart(customStart(actual));
    expect(harness.workingMessages).toEqual([ADVISOR_WORKING_MESSAGE]);
  });

  it("ignores ordinary user messages for control transitions", async () => {
    const harness = setup();
    harness.idle = false;
    await harness.controller.handleAdvise("");
    await harness.deliverUser(harness.customQueue[0]!.content);
    expect(harness.phase()).toBe("adviceQueued");
  });
});

describe("activation and restoration failures", () => {
  it("rejects invalid configuration, missing model, and missing auth", async () => {
    const invalid = setup();
    invalid.config = { ok: false, error: "bad config" };
    await invalid.controller.handleAdvise("");
    expect(invalid.sent).toEqual([]);

    const missing = setup();
    missing.advisor = undefined;
    await missing.controller.handleAdvise("");
    expect(missing.lastNotify()?.message).toMatch(/not found/);

    const unauthenticated = setup();
    unauthenticated.hasAuthFlag = false;
    await unauthenticated.controller.handleAdvise("");
    expect(unauthenticated.lastNotify()?.message).toMatch(/No API key/);
  });

  it("fails closed on a boolean advisor switch failure", async () => {
    const harness = setup();
    harness.advisorSwitch = "false";
    await harness.controller.handleAdvise("");
    expect(harness.sent).toEqual([]);
    expect(harness.thinkingSet).toEqual([]);
    expect(harness.toolsSet).toEqual([]);
    expect(harness.phase()).toBe("idle");
  });

  it("restores after a thrown partially-mutating advisor switch", async () => {
    const harness = setup();
    harness.advisorSwitch = "mutate-throw";
    await harness.controller.handleAdvise("");
    expect(harness.setModelCalls).toEqual([ADVISOR, ADVISEE]);
    expect(harness.live.model).toBe(ADVISEE);
    expect(harness.sent).toEqual([]);
    expect(harness.lastNotify()?.message).toMatch(/Failed to activate/);
  });

  it("sends no continuation and disables automatic advice when restore fails", async () => {
    const harness = setup();
    harness.controller.handleAdviseEvery("2");
    harness.adviseeSwitch = "false";
    await harness.controller.handleAdvise("");
    await harness.deliverNext();
    await harness.runTurn({ stopReason: "stop", text: "realization" });

    expect(harness.sent).toHaveLength(1);
    expect(harness.controller.currentSchedule()).toBeNull();
    expect(harness.phase()).toBe("idle");
    expect(harness.lastNotify()?.message).toContain("/model");
  });

  it("accepts a thrown restore when the live model was already restored", async () => {
    const harness = setup();
    harness.adviseeSwitch = "mutate-throw";
    await harness.controller.handleAdvise("");
    await harness.deliverNext();
    await harness.runTurn({ stopReason: "stop", text: "realization" });
    expect(harness.live.model).toBe(ADVISEE);
    expect(harness.sent).toHaveLength(2);
    expect(harness.phase()).toBe("continuationQueued");
  });
});

describe("review completion and tool policy", () => {
  it("keeps a tool-enabled review active across toolUse", async () => {
    const harness = setup();
    await harness.controller.handleAdvise("--tools");
    await harness.deliverNext();
    expect(harness.workingMessages).toEqual([ADVISOR_WORKING_MESSAGE]);
    await harness.runTurn({ stopReason: "toolUse", text: "investigating" });
    expect(harness.phase()).toBe("advisorActive");
    expect(harness.workingMessages).toEqual([ADVISOR_WORKING_MESSAGE]);
    expect(harness.setModelCalls).toEqual([ADVISOR]);
    await harness.runTurn({ stopReason: "stop", text: "realization" });
    expect(harness.phase()).toBe("continuationQueued");
    expect(harness.workingMessages).toEqual([
      ADVISOR_WORKING_MESSAGE,
      undefined,
    ]);
  });

  it("finalizes a tool-free toolUse response when it has usable text", async () => {
    const harness = setup();
    await harness.controller.handleAdvise("");
    await harness.deliverNext();
    await harness.runTurn({ stopReason: "toolUse", text: "realization" });
    expect(harness.setModelCalls).toEqual([ADVISOR, ADVISEE]);
    expect(harness.workingMessages).toEqual([
      ADVISOR_WORKING_MESSAGE,
      undefined,
    ]);
    expect(harness.phase()).toBe("continuationQueued");
  });

  it("restores without continuation for tool-free empty toolUse", async () => {
    const harness = setup();
    await harness.controller.handleAdvise("");
    await harness.deliverNext();
    await harness.runTurn({ stopReason: "toolUse", text: "" });
    expect(harness.sent).toHaveLength(1);
    expect(harness.workingMessages).toEqual([
      ADVISOR_WORKING_MESSAGE,
      undefined,
    ]);
    expect(harness.phase()).toBe("idle");
    expect(harness.lastNotify()?.level).toBe("warning");
  });

  it.each(["error", "aborted"] as const)(
    "restores without continuation after %s",
    async (stopReason) => {
      const harness = setup();
      await harness.controller.handleAdvise("");
      await harness.deliverNext();
      await harness.runTurn({ stopReason });
      expect(harness.sent).toHaveLength(1);
      expect(harness.workingMessages).toEqual([
        ADVISOR_WORKING_MESSAGE,
        undefined,
      ]);
      expect(harness.live.model).toBe(ADVISEE);
      expect(harness.phase()).toBe("idle");
    },
  );

  it("restores without continuation for an empty final response", async () => {
    const harness = setup();
    await harness.controller.handleAdvise("");
    await harness.deliverNext();
    await harness.runTurn({ stopReason: "stop", text: "" });
    expect(harness.sent).toHaveLength(1);
    expect(harness.workingMessages).toEqual([
      ADVISOR_WORKING_MESSAGE,
      undefined,
    ]);
    expect(harness.phase()).toBe("idle");
  });

  it("accepts a length-limited response when it has usable text", async () => {
    const harness = setup();
    await harness.controller.handleAdvise("");
    await harness.deliverNext();
    await harness.runTurn({ stopReason: "length", text: "useful realization" });
    expect(harness.phase()).toBe("continuationQueued");
  });
});

describe("automatic /advise-every cadence", () => {
  it("counts original-model low-level turns including toolUse and triggers on N", async () => {
    const harness = setup();
    harness.idle = false;
    harness.controller.handleAdviseEvery("2");

    await harness.runTurn({ stopReason: "stop", text: "work 1" });
    expect(harness.controller.currentSchedule()?.count).toBe(1);
    await harness.runTurn({ stopReason: "toolUse", text: "work 2" });
    expect(harness.controller.currentSchedule()?.count).toBe(0);
    expect(harness.phase()).toBe("adviceQueued");

    await harness.deliverNext();
    await harness.runTurn({ stopReason: "stop", text: "realization" });
    await harness.deliverNext();
    await harness.runTurn({ stopReason: "stop", text: "continue" });
    expect(harness.controller.currentSchedule()?.count).toBe(0);
    await harness.runTurn({ stopReason: "stop", text: "work 3" });
    expect(harness.controller.currentSchedule()?.count).toBe(1);
  });

  it("does not jump a below-threshold counter merely because messages are pending", async () => {
    const harness = setup();
    harness.idle = false;
    harness.controller.handleAdviseEvery("3");
    harness.userPending = 1;

    await harness.runTurn({ stopReason: "stop", text: "work 1" });
    expect(harness.controller.currentSchedule()?.count).toBe(1);
    await harness.runTurn({ stopReason: "stop", text: "work 2" });
    expect(harness.controller.currentSchedule()?.count).toBe(2);
    expect(harness.sent).toEqual([]);
  });

  it("saturates at the actual threshold and starts after pending work drains", async () => {
    const harness = setup();
    harness.idle = false;
    harness.controller.handleAdviseEvery("2");
    await harness.runTurn({ stopReason: "stop", text: "work 1" });
    harness.userPending = 1;
    await harness.runTurn({ stopReason: "stop", text: "work 2" });
    expect(harness.controller.currentSchedule()?.count).toBe(2);
    expect(harness.sent).toEqual([]);

    harness.userPending = 0;
    await harness.runTurn({ stopReason: "stop", text: "queue drained" });
    expect(harness.phase()).toBe("adviceQueued");
    expect(harness.sent).toHaveLength(1);
  });

  it("returns an automatic activation race to saturated deferred state", async () => {
    const harness = setup();
    harness.idle = false;
    harness.controller.handleAdviseEvery("1");
    harness.afterAdvisorSwitch = () => {
      harness.userPending = 1;
      harness.afterAdvisorSwitch = undefined;
    };

    await harness.runTurn({ stopReason: "stop", text: "threshold" });
    expect(harness.sent).toEqual([]);
    expect(harness.live.model).toBe(ADVISEE);
    expect(harness.controller.currentSchedule()?.count).toBe(1);
    expect(harness.notifies).toHaveLength(1); // schedule-enabled message only

    harness.userPending = 0;
    await harness.runTurn({ stopReason: "stop", text: "drained" });
    expect(harness.sent).toHaveLength(1);
    expect(harness.phase()).toBe("adviceQueued");
  });

  it("waits a full new interval after a genuine automatic start failure", async () => {
    const harness = setup();
    harness.idle = false;
    harness.controller.handleAdviseEvery("2");
    await harness.runTurn({ stopReason: "stop", text: "work 1" });
    harness.config = { ok: false, error: "broken" };
    await harness.runTurn({ stopReason: "stop", text: "work 2" });
    expect(harness.controller.currentSchedule()?.count).toBe(0);

    await harness.runTurn({ stopReason: "stop", text: "work 3" });
    expect(harness.controller.currentSchedule()?.count).toBe(1);
  });

  it("does not count a turn recorded under the advisor model", async () => {
    const harness = setup();
    harness.idle = false;
    harness.controller.handleAdviseEvery("2");
    await harness.runTurn({
      stopReason: "stop",
      provider: ADVISOR.provider,
      model: ADVISOR.id,
    });
    expect(harness.controller.currentSchedule()?.count).toBe(0);
  });

  it("manual advice leaves an existing counter unchanged", async () => {
    const harness = setup();
    harness.idle = false;
    harness.controller.handleAdviseEvery("3");
    await harness.runTurn({ stopReason: "stop" });
    harness.idle = true;
    await harness.controller.handleAdvise("");
    await harness.deliverNext();
    await harness.runTurn({ stopReason: "stop", text: "realization" });
    await harness.deliverNext();
    await harness.runTurn({ stopReason: "stop", text: "continue" });
    expect(harness.controller.currentSchedule()?.count).toBe(1);
  });

  it("reconfiguration resets fields and off disables future cycles", async () => {
    const harness = setup();
    harness.idle = false;
    harness.controller.handleAdviseEvery("3");
    await harness.runTurn({ stopReason: "stop" });
    harness.controller.handleAdviseEvery("5 --tools focus on risks");
    expect(harness.controller.currentSchedule()).toMatchObject({
      every: 5,
      tools: true,
      context: "focus on risks",
      count: 0,
    });
    harness.controller.handleAdviseEvery("off");
    expect(harness.controller.currentSchedule()).toBeNull();
  });
});

describe("FIFO continuation and lifecycle", () => {
  it("preserves an earlier user steer under the restored model before continuation", async () => {
    const harness = setup();
    harness.idle = false;
    await harness.controller.handleAdvise("");
    await harness.runTurn({ stopReason: "stop", text: "tail" });
    await harness.deliverNext();

    harness.userPending = 1;
    await harness.runTurn({ stopReason: "stop", text: "realization" });
    expect(harness.phase()).toBe("continuationQueued");
    expect(harness.loop.model).toBe(ADVISEE);

    await harness.deliverUser("do this first");
    await harness.runTurn({ stopReason: "stop", text: "done" });
    expect(harness.phase()).toBe("continuationQueued");
    await harness.deliverNext();
    await harness.runTurn({ stopReason: "stop", text: "continue" });
    expect(harness.phase()).toBe("idle");
  });

  it("retains a same-session schedule across reload and validates config", () => {
    const harness = setup();
    harness.controller.handleAdviseEvery("3");
    harness.controller.onSessionStart({
      type: "session_start",
      reason: "reload",
    } as unknown as SessionStartEvent);
    expect(harness.controller.currentSchedule()?.every).toBe(3);

    harness.config = { ok: false, error: "global: missing provider" };
    harness.controller.onSessionStart({
      type: "session_start",
      reason: "reload",
    } as unknown as SessionStartEvent);
    expect(harness.lastNotify()?.message).toMatch(/invalid/);
  });

  it("clears a mismatched schedule on reload and nonreload session start", () => {
    const mismatch = setup();
    mismatch.controller.handleAdviseEvery("3");
    mismatch.sessionId = "sess-2";
    mismatch.controller.onSessionStart({
      type: "session_start",
      reason: "reload",
    } as unknown as SessionStartEvent);
    expect(mismatch.controller.currentSchedule()).toBeNull();

    const replaced = setup();
    replaced.controller.handleAdviseEvery("3");
    replaced.controller.onSessionStart({
      type: "session_start",
      reason: "resume",
    } as unknown as SessionStartEvent);
    expect(replaced.controller.currentSchedule()).toBeNull();
  });

  it("restores defensively on nonreload shutdown", async () => {
    const harness = setup();
    await harness.controller.handleAdvise("");
    await harness.controller.onSessionShutdown({
      type: "session_shutdown",
      reason: "quit",
    } as unknown as SessionShutdownEvent);
    expect(harness.workingMessages).toEqual([]);
    expect(harness.setModelCalls).toEqual([ADVISOR, ADVISEE]);
    expect(harness.phase()).toBe("idle");
  });

  it("clears the working message on reload shutdown while preserving schedule", async () => {
    const harness = setup();
    harness.controller.handleAdviseEvery("3");
    await harness.controller.handleAdvise("");
    await harness.deliverNext();
    await harness.controller.onSessionShutdown({
      type: "session_shutdown",
      reason: "reload",
    } as unknown as SessionShutdownEvent);
    expect(harness.workingMessages).toEqual([
      ADVISOR_WORKING_MESSAGE,
      undefined,
    ]);
    expect(harness.controller.currentSchedule()?.every).toBe(3);
  });
});
