/** Display-only diagnosis. It does not approve actions or establish a repair result. */
export interface RepairPlan {
  symptom: string;
  causes: Array<{
    label: string;
    likelihood: "likely" | "possible" | "ruled_out";
    evidence?: string;
  }>;
  fixes: Array<{
    label: string;
    cause?: string;
    status: "pending" | "trying" | "worked" | "failed" | "skipped" | "declined";
  }>;
}
