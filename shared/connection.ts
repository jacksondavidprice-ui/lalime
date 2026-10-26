/** Result of a small model request after authentication. Sign-in alone is not ready. */
export type ConnectionCheck = {
  /** Requested check model, or "Provider default" when the resolved model is not reported. */
  model: string;
  /** Provider-reported display labels, when available. Never infer a plan. */
  account?: string;
  plan?: string;
} & (
  | { state: "checking" }
  | { state: "ready" }
  | { state: "failed"; reason: string }
);
