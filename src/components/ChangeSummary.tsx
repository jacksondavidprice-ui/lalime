import { useEffect, useId, useRef, useState } from "react";
import { Check, History, Undo2 } from "lucide-react";
import type { ActivityEntry, AppSnapshot } from "@shared/types";
import { getApi } from "../lib/bridge";
import { useAppStore } from "../lib/store";
import { visibleText } from "../lib/visible-text";
import { t } from "../copy";

function lastUser(snapshot: Pick<AppSnapshot, "messages">) {
  return [...snapshot.messages].reverse().find((message) => message.role === "user");
}
function eligible(entry: ActivityEntry) { return entry.undoable && !entry.undone && !!entry.actionId; }
function undoProblem(entry: ActivityEntry | undefined): string | null {
  // Older snapshots can omit partial progress counts.
  const result = entry?.undoResult as { status: string; reason?: string; restored?: number; total?: number } | undefined;
  if (!result || (result.status !== "failed" && result.status !== "partly_restored")) return null;
  const counted = Number.isInteger(result.restored) && Number.isInteger(result.total)
    && result.restored! > 0 && result.total! > result.restored!;
  if (result.status === "failed" && !counted) return result.reason || t("changes.failed");
  const summary = counted ? t("changes.partlyCount").replace("{restored}", String(result.restored)).replace("{total}", String(result.total))
    : t("changes.partly");
  return result.reason ? `${summary} ${result.reason}` : summary;
}

export function ChangeSummary() {
  const contextId = useId();
  const activity = useAppStore((state) => state.activity);
  const messages = useAppStore((state) => state.messages);
  const running = useAppStore((state) => state.running);
  const pending = useAppStore((state) => state.pendingApproval);
  const pendingCount = useAppStore((state) => state.pendingApprovalCount);
  const historyDetails = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastUndo, setLastUndo] = useState<{ entryId: string; taskId?: string } | null>(null);
  const [stoppedBatch, setStoppedBatch] = useState<{ entryId: string; taskId?: string } | null>(null);
  const resultElements = useRef(new Map<string, HTMLParagraphElement>());
  const operation = useRef<{ cancelled: boolean } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const previousRestores = useRef(new Map<string, boolean>());
  const restoreIcons = useRef(new Map<string, HTMLSpanElement>());
  const user = lastUser({ messages });
  const current = user ? activity.filter((entry) => entry.at >= user.createdAt) : [];
  const undoCount = current.filter(eligible).length;
  const restoredCount = current.filter((entry) => entry.undone && entry.undoResult?.status === "restored").length;
  const history = user ? activity.filter((entry) => entry.at < user.createdAt) : activity;
  const withdrawalRevision = history.filter((entry) => entry.approvalWithdrawal).map((entry) => `${entry.id}:${entry.approvalWithdrawal!.actionId}`).join("|");
  const nextStep = pending ? t("changes.nextApproval") : pendingCount && pendingCount > 0 ? t("changes.nextPreparing")
    : running ? t("changes.nextWorking") : pendingCount === 0 ? t("changes.nextNone") : t("changes.nextReady");

  useEffect(() => {
    if (withdrawalRevision && historyDetails.current) historyDetails.current.open = true;
  }, [withdrawalRevision]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const animations: Animation[] = [];
    const next = new Map<string, boolean>();
    for (const entry of activity) {
      const restored = !!entry.undone && entry.undoResult?.status === "restored";
      next.set(entry.id, restored);
      // Only a verified transition earns a cue; loaded history stays still.
      if (restored && previousRestores.current.get(entry.id) === false && !reducedMotion) {
        const icon = restoreIcons.current.get(entry.id);
        if (icon) animations.push(icon.animate([
          { transform: "translateX(-4px) rotate(-35deg)", opacity: 0.35 },
          { transform: "translateX(0) rotate(0)", opacity: 1 },
        ], { duration: 420, easing: "ease-out" }));
      }
    }
    previousRestores.current = next;
    return () => { for (const animation of animations) animation.cancel(); };
  }, [activity, reducedMotion]);

  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (next.running || next.pendingApproval || (next.stopped && !previous.stopped) || lastUser(next)?.id !== lastUser(previous)?.id) {
        if (operation.current) operation.current.cancelled = true;
      }
    });
    return () => { unsubscribe(); if (operation.current) operation.current.cancelled = true; };
  }, []);

  async function restore(entries: ActivityEntry[]) {
    const initial = useAppStore.getState();
    if (operation.current || initial.running || initial.pendingApproval) return;
    const taskId = lastUser(initial)?.id;
    const sourceFocus = document.activeElement;
    const restoreFocus = sourceFocus instanceof HTMLElement && sourceFocus.hasAttribute("data-undo-trigger");
    const batch = { cancelled: false };
    operation.current = batch;
    setStoppedBatch(null);
    let resultToFocus: string | undefined;
    try {
      for (const requested of entries) {
        const state = useAppStore.getState();
        if (batch.cancelled || state.running || state.pendingApproval || lastUser(state)?.id !== taskId) break;
        const entry = state.activity.find((candidate) => candidate.id === requested.id);
        if (!entry || !eligible(entry)) continue;
        setBusy(entry.id);
        setErrors((previous) => { const next = { ...previous }; delete next[entry.id]; return next; });
        try {
          await getApi().undo(entry.id);
          if (batch.cancelled) break;
          // A resolved command is not proof of a successful restore.
          const verified = (await getApi().getSnapshot()).activity.find((candidate) => candidate.id === entry.id);
          if (batch.cancelled) break;
          if (verified?.undoResult?.status !== "restored" || !verified.undone) {
            setErrors((previous) => ({ ...previous, [entry.id]: undoProblem(verified) ?? t("changes.unverified") }));
            if (entries.length > 1) setStoppedBatch({ entryId: entry.id, taskId });
            resultToFocus = entry.id;
            break;
          }
          setLastUndo({ entryId: entry.id, taskId });
          resultToFocus = entry.id;
        } catch {
          if (!batch.cancelled) {
            setErrors((previous) => ({ ...previous, [entry.id]: t("changes.failed") }));
            if (entries.length > 1) setStoppedBatch({ entryId: entry.id, taskId });
            resultToFocus = entry.id;
          }
          break;
        }
      }
    } finally {
      if (operation.current === batch) { operation.current = null; setBusy(null); }
      if (restoreFocus && resultToFocus) requestAnimationFrame(() => {
        if (batch.cancelled || lastUser(useAppStore.getState())?.id !== taskId) return;
        if (document.activeElement === document.body || document.activeElement === sourceFocus) {
          resultElements.current.get(resultToFocus!)?.focus({ preventScroll: true });
        }
      });
    }
  }

  function rows(entries: ActivityEntry[]) {
    return <ul className="mt-4 space-y-3">{entries.map((entry) => {
      const restored = entry.undone && entry.undoResult?.status === "restored";
      const error = restored ? null : undoProblem(entry) ?? errors[entry.id];
      return <li key={entry.id} className="rounded-xl border border-line bg-surface/40 p-3 text-sm [overflow-wrap:anywhere]" data-testid="change-entry">
        <p id={`${contextId}-${encodeURIComponent(entry.id)}`} className={restored ? "text-muted" : "text-ink"}>{visibleText(entry.summary)}</p>
        {restored ? <p role="status" tabIndex={-1} data-testid="undo-result" aria-describedby={`${contextId}-${encodeURIComponent(entry.id)}`}
          ref={(element) => { if (element) resultElements.current.set(entry.id, element); else resultElements.current.delete(entry.id); }}
          className="mt-2 flex items-center gap-1.5 rounded text-xs text-lime focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"><span className="inline-flex" data-restore-cue={entry.id} ref={(element) => { if (element) restoreIcons.current.set(entry.id, element); else restoreIcons.current.delete(entry.id); }} aria-hidden><Check className="h-3.5 w-3.5" /></span>{t("changes.restored")}</p>
          : eligible(entry) ? <button type="button" data-undo-trigger aria-describedby={`${contextId}-${encodeURIComponent(entry.id)}`} disabled={!!busy || running || !!pending} onClick={() => void restore([entry])} data-testid="undo-button" className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg border border-lime/20 bg-lime/5 px-3 text-xs font-semibold text-lime transition enabled:hover:bg-lime/10 disabled:opacity-45"><Undo2 className="h-3.5 w-3.5" aria-hidden />{busy === entry.id ? t("changes.restoring") : t(error ? "changes.retry" : "changes.undo")}</button>
            : <p className="mt-2 text-xs text-muted">{t("changes.noUndo")}</p>}
        {error && <p role="alert" tabIndex={-1} aria-describedby={`${contextId}-${encodeURIComponent(entry.id)}`}
          ref={(element) => { if (element) resultElements.current.set(entry.id, element); else resultElements.current.delete(entry.id); }}
          className="mt-2 rounded text-xs leading-relaxed text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">{visibleText(error)}</p>}
        {error && stoppedBatch?.entryId === entry.id && stoppedBatch.taskId === user?.id
          && <p role="status" className="mt-2 text-xs leading-relaxed text-muted">{t("changes.batchStopped")}</p>}
        {restored && !entry.approvalWithdrawal && lastUndo?.entryId === entry.id && lastUndo.taskId === user?.id
          && <p data-testid="undo-next-step" role="status" className="mt-2 text-xs leading-relaxed text-muted">{nextStep}</p>}
        {entry.approvalWithdrawal && <div data-testid="approval-withdrawal" role="status" aria-live="polite" aria-atomic="true"
          aria-describedby={`${contextId}-${encodeURIComponent(entry.id)}`} className="mt-3 rounded-lg border border-line bg-paper/60 p-3 text-xs leading-relaxed text-ink-soft">
          <p className="mb-1 font-semibold text-ink">{t("changes.afterUndo")}</p>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{visibleText(entry.approvalWithdrawal.message)}</p>
          <p className="mt-2 text-muted">{nextStep}</p>
        </div>}
      </li>;
    })}</ul>;
  }

  if (!activity.length) return null;
  return <section data-testid="change-summary" className="rounded-2xl border border-line bg-paper-2/60 p-4 sm:p-5">
    {current.length > 0 && <div data-testid="change-summary-current">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><History className="h-4 w-4 text-lime" aria-hidden />{t("changes.title")}</h2>
        {current.filter(eligible).length > 1 && <button type="button" data-undo-trigger disabled={!!busy || running || !!pending} onClick={() => void restore(current.filter(eligible))} className="min-h-9 rounded-lg border border-line px-3 text-xs text-muted enabled:hover:text-ink disabled:opacity-45">{t("changes.undoAll")}</button>}
      </div>
      {!running && !pending && !busy && pendingCount === 0 && <p data-testid="activity-recap" role="status" aria-live="polite" aria-atomic="true" className="mt-3 border-l-2 border-lime/30 pl-3 text-xs leading-relaxed text-muted">
        {t(current.length === 1 ? "changes.recordOne" : "changes.recordCount").replace("{count}", String(current.length))}{" "}
        {undoCount ? t("changes.undoCount").replace("{count}", String(undoCount)) : t("changes.undoNone")}
        {restoredCount > 0 && ` ${t(restoredCount === 1 ? "changes.restoreOne" : "changes.restoreCount").replace("{count}", String(restoredCount))}`}
      </p>}
      {rows(current)}
    </div>}
    {(running || pending) && activity.some(eligible) && <p className="mt-3 text-xs text-muted">{t("changes.wait")}</p>}
    {busy && <button type="button" onClick={() => { if (operation.current) operation.current.cancelled = true; }} className="mt-3 min-h-9 rounded-lg border border-line px-3 text-xs text-muted">{t("changes.stopUndo")}</button>}
    {history.length > 0 && (user ? <details ref={historyDetails} className={current.length ? "mt-4 border-t border-line pt-4" : ""}><summary className="cursor-pointer text-sm text-muted">{t("changes.history")}</summary>{rows(history)}</details>
      : <><h2 className="text-sm font-semibold text-ink">{t("changes.recorded")}</h2>{rows(history)}</>)}
  </section>;
}
