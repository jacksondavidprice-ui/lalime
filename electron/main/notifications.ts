import { Notification, type BrowserWindow } from "electron";
import type { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import type { AppSnapshot } from "../../shared/types.js";

/** Keep task and command content out of operating system notification history. */
export function attachDesktopNotifications(source: EventEmitter, window: BrowserWindow): () => void {
  let closed = false;
  let startedAt: number | undefined;
  const announcedApprovals = new Set<string>();
  const active = new Set<Notification>();

  const notify = (body: string): void => {
    let notification: Notification | undefined;
    try {
      if (closed || window.isDestroyed() || window.isFocused() || !Notification.isSupported()) return;
      notification = new Notification({ title: "Lalime", body });
      const current = notification;
      active.add(current);
      const retire = () => { active.delete(current); current.removeAllListeners(); };
      current.once("close", retire);
      current.once("failed", retire);
      current.on("click", () => {
        if (closed || window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      });
      current.show();
    } catch {
      // Notification failure must not change task execution or approval state.
      if (notification) {
        active.delete(notification);
        notification.removeAllListeners();
      }
    }
  };

  const onSnapshot = (snapshot: AppSnapshot): void => {
    if (closed) return;
    if (snapshot.running && startedAt === undefined) startedAt = performance.now();
    const actionId = snapshot.pendingApproval?.action.id;
    if (actionId && !announcedApprovals.has(actionId)) {
      announcedApprovals.add(actionId);
      notify("An approval is waiting. Open Lalime to review it.");
    }
    if (!snapshot.running && startedAt !== undefined) {
      const elapsed = performance.now() - startedAt;
      startedAt = undefined;
      if (!snapshot.stopped && snapshot.statusText === "Done" && elapsed >= 30000) {
        notify("Your task has finished. Open Lalime to review the result.");
      }
    }
  };
  source.on("snapshot", onSnapshot);
  return () => {
    if (closed) return;
    closed = true;
    source.off("snapshot", onSnapshot);
    for (const notification of active) {
      notification.removeAllListeners();
      try { notification.close(); } catch { /* The OS may have already removed it. */ }
    }
    active.clear();
  };
}
