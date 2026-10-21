import { create } from "zustand";
import type { AppSnapshot } from "@shared/types";
import { getApi } from "./bridge";

const empty: AppSnapshot = {
  mode: "live",
  auth: { state: "signed_out" },
  onboardingComplete: false,
  messages: [],
  plan: [],
  activity: [],
  pendingApproval: null,
  blockedNotice: null,
  running: false,
  stopped: false,
  statusText: "Starting…",
  hands: { backend: "node", available: true },
  writer: { enabled: false, keyHint: null },
};

interface AppState extends AppSnapshot {
  ready: boolean;
  hydrate: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  ...empty,
  ready: false,
  hydrate: async () => {
    const api = getApi();
    const snap = await api.getSnapshot();
    set({ ...snap, ready: true });
    api.subscribe((next) => set({ ...next, ready: true }));
  },
}));
