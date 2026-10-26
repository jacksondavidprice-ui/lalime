import { create } from "zustand";
import type { AppSnapshot } from "@shared/types";
import type { ConnectionCheck } from "@shared/connection";
import { connectionFromSnapshot } from "./connection";
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
  connection?: ConnectionCheck;
  ready: boolean;
  hydrate: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  ...empty,
  ready: false,
  hydrate: async () => {
    const api = getApi();
    const snap = await api.getSnapshot();
    set({ ...snap, connection: connectionFromSnapshot(snap), repairPlan: snap.repairPlan, ready: true });
    api.subscribe((next) => set({ ...next, connection: connectionFromSnapshot(next), repairPlan: next.repairPlan, ready: true }));
  },
}));
