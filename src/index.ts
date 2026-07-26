/**
 * pi-advice extension entrypoint.
 *
 * Wires the {@link AdviceController} into Pi's command and event surfaces. The
 * controller is the single source of cycle state; this module only adapts the
 * live Pi objects into its {@link AdviceDeps} interface.
 *
 * Pi hands a fresh `ctx` to each handler. Those `ctx` objects expose the same
 * session, so the most recent one is kept in `ctxRef` for the deps closures to
 * read. Extension event emission is sequential, so only one handler is active
 * at a time and `ctxRef` is stable for the duration of a call.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  AdviceController,
  type AdviceDeps,
  type AdvisorModel,
} from "./advice-controller.js";
import { adviceCompletions, adviceEveryCompletions } from "./command.js";
import { loadConfig } from "./config.js";
import type { NotifyLevel } from "./types.js";

export default function piAdvice(pi: ExtensionAPI): void {
  let ctxRef: ExtensionContext | undefined;
  const ctx = (): ExtensionContext => {
    if (!ctxRef) throw new Error("pi-advice: no extension context available");
    return ctxRef;
  };

  const deps: AdviceDeps = {
    loadConfig: () => loadConfig(ctx().cwd, ctx().isProjectTrusted()),
    findAdvisor: (provider, model) => ctx().modelRegistry.find(provider, model),
    hasAuth: (model: AdvisorModel) =>
      ctx().modelRegistry.hasConfiguredAuth(model),
    getAdviseeModel: () => ctx().model,
    getThinking: () => pi.getThinkingLevel(),
    getActiveTools: () => pi.getActiveTools(),
    setModel: (model) => pi.setModel(model),
    setThinking: (level) => pi.setThinkingLevel(level),
    setActiveTools: (names) => pi.setActiveTools(names),
    sendUserMessage: (content, opts) => {
      void pi.sendUserMessage(content, opts);
    },
    isIdle: () => ctx().isIdle(),
    hasPendingMessages: () => ctx().hasPendingMessages(),
    notify: (message, level) => ctx().ui.notify(message, level),
    getSessionId: () => ctx().sessionManager.getSessionId(),
  };

  const controller = new AdviceController(deps);
  const setCtx = (next: ExtensionContext): void => {
    ctxRef = next;
  };

  pi.registerCommand("advice", {
    description:
      "Invite a configured advisor model to review the advisee's work, then continue",
    getArgumentCompletions: adviceCompletions,
    handler: async (args, c: ExtensionCommandContext) => {
      setCtx(c);
      await controller.handleAdvice(args);
    },
  });

  pi.registerCommand("advice-every", {
    description:
      "Enable, replace, or disable periodic advisor review ('off' to disable)",
    getArgumentCompletions: adviceEveryCompletions,
    handler: async (args, c: ExtensionCommandContext) => {
      setCtx(c);
      controller.handleAdviceEvery(args);
    },
  });

  pi.on("message_start", async (event, c) => {
    setCtx(c);
    await controller.onMessageStart(event);
  });

  pi.on("turn_end", async (event, c) => {
    setCtx(c);
    await controller.onTurnEnd(event);
  });

  pi.on("session_start", async (event, c) => {
    setCtx(c);
    controller.onSessionStart(event);
  });

  pi.on("session_shutdown", async (event, c) => {
    setCtx(c);
    controller.onSessionShutdown(event);
  });
}
