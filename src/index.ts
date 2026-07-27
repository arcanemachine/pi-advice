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
import { adviseCompletions, adviseEveryCompletions } from "./command.js";
import { loadConfig } from "./config.js";

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
    sendMessage: (message, options) => pi.sendMessage(message, options),
    isIdle: () => ctx().isIdle(),
    hasPendingMessages: () => ctx().hasPendingMessages(),
    notify: (message, level) => ctx().ui.notify(message, level),
    getSessionId: () => ctx().sessionManager.getSessionId(),
  };

  const controller = new AdviceController(deps);
  const setCtx = (next: ExtensionContext): void => {
    ctxRef = next;
  };

  pi.registerCommand("advise", {
    description:
      "Reconsider the assistant's current work with a configured model, then continue",
    getArgumentCompletions: adviseCompletions,
    handler: async (args, commandContext: ExtensionCommandContext) => {
      setCtx(commandContext);
      await controller.handleAdvise(args);
    },
  });

  pi.registerCommand("advise-every", {
    description:
      "Enable, replace, or disable periodic reconsideration ('off' to disable)",
    getArgumentCompletions: adviseEveryCompletions,
    handler: async (args, commandContext: ExtensionCommandContext) => {
      setCtx(commandContext);
      controller.handleAdviseEvery(args);
    },
  });

  pi.on("message_start", async (event, context) => {
    setCtx(context);
    await controller.onMessageStart(event);
  });

  pi.on("turn_end", async (event, context) => {
    setCtx(context);
    await controller.onTurnEnd(event);
  });

  pi.on("session_start", async (event, context) => {
    setCtx(context);
    controller.onSessionStart(event);
  });

  pi.on("session_shutdown", async (event, context) => {
    setCtx(context);
    await controller.onSessionShutdown(event);
  });
}
