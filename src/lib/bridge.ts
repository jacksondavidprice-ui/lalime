import type { LalimeApi } from "@shared/ipc";
import { isBrowserScriptedMockAllowed } from "./dev-flags";
import { getDemoEngine } from "./demo-engine";
import { getSignedOutEngine } from "./signed-out-engine";

declare global {
  interface Window {
    lalime?: LalimeApi;
  }
}

/** Prefer Electron preload API; browser falls back to gated mock or signed-out stub. */
export function getApi(): LalimeApi {
  if (window.lalime) return window.lalime;

  if (isBrowserScriptedMockAllowed()) {
    const engine = getDemoEngine();
    return {
      getSnapshot: async () => engine.getSnapshot(),
      subscribe: (cb) => engine.subscribe(cb),
      completeOnboarding: async () => engine.completeOnboarding(),
      setMode: async (mode) => engine.setMode(mode),
      signInDemo: async () => engine.signInDemo(),
      signInChatgpt: async () => engine.signInChatgpt(),
      signInApiKey: async (key) => engine.signInApiKey(key),
      sendMessage: async (text) => engine.sendMessage(text),
      respondApproval: async (choice, actionId) => engine.respondApproval(choice, actionId),
      undo: async (id) => engine.undo(id),
      stop: async () => engine.stop(),
      dismissBlocked: async () => engine.dismissBlocked(),
      runDemoScenario: async (id) => engine.runDemoScenario(id),
      writerStatus: async () => ({ enabled: false, providerId: null, model: null }),
      updateSettings: async () => ({ ok: false, message: "Open the desktop app to save settings." }),
      connectProvider: async () => ({ ok: false, message: "Open the desktop app to connect a provider." }),
      disconnect: async () => {},
      copyText: async (text) => navigator.clipboard.writeText(text),
    };
  }

  const engine = getSignedOutEngine();
  return {
    getSnapshot: async () => engine.getSnapshot(),
    subscribe: (cb) => engine.subscribe(cb),
    completeOnboarding: async () => engine.completeOnboarding(),
    setMode: async () => engine.setMode(),
    signInDemo: async () => engine.signInDemo(),
    signInChatgpt: async () => engine.signInChatgpt(),
    signInApiKey: async () => engine.signInApiKey(),
    sendMessage: async (text) => engine.sendMessage(text),
    respondApproval: async () => engine.respondApproval(),
    undo: async () => engine.undo(),
    stop: async () => engine.stop(),
    dismissBlocked: async () => engine.dismissBlocked(),
    runDemoScenario: async (id) => engine.runDemoScenario(id),
    writerStatus: async () => ({ enabled: false, providerId: null, model: null }),
    updateSettings: async () => ({ ok: false, message: "Open the desktop app to save settings." }),
    connectProvider: async () => ({ ok: false, message: "Open the desktop app to connect a provider." }),
    disconnect: async () => {},
    copyText: async (text) => navigator.clipboard.writeText(text),
  };
}
