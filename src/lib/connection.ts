import type { AppSnapshot } from "@shared/types";

import type { ConnectionCheck } from "@shared/connection";

export type ConnectionStatus = ConnectionCheck;
export function connectionFromSnapshot(snapshot: Pick<AppSnapshot, "auth"> & { connection?: ConnectionCheck }): ConnectionCheck | undefined {
  return snapshot.connection;
}
export function connectionLabel(auth: AppSnapshot["auth"], running: boolean, connection?: ConnectionStatus) {
  if (running) return "Working";
  if (connection?.state === "checking" || auth.state === "signing_in") return "Checking";
  if (connection?.state === "failed" || auth.state === "error") return "Problem";
  if (auth.state === "signed_out") return "Signed out";
  return connection?.state === "ready" ? "Ready" : "Checking";
}
