import { useEffect, useId, useRef, useState } from "react";
import { motion, useIsPresent, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, File, ShieldCheck } from "lucide-react";
import type { ApprovalChoice, ApprovalQueueEntry, PendingApproval } from "@shared/types";
import { t } from "../copy";
import { PrimaryButton } from "./PrimaryButton";
import { HoldConfirmation } from "./HoldConfirmation";
import { getApi } from "../lib/bridge";
import { visibleText } from "../lib/visible-text";

type ApprovalCardProps = { pending: PendingApproval; pendingCount?: number; queue?: readonly ApprovalQueueEntry[] };

export function ApprovalCard({ pending, pendingCount, queue }: ApprovalCardProps) {
  // A new action must not inherit the previous action's timer or choice.
  return <ApprovalPrompt key={pending.action.id} pending={pending} pendingCount={pendingCount} queue={queue} />;
}

function ApprovalPrompt({ pending, pendingCount, queue }: ApprovalCardProps) {
  const [openDetails, setOpenDetails] = useState(false);
  const [fullPayload, setFullPayload] = useState(false);
  const [payloadOverflows, setPayloadOverflows] = useState(false);
  const payloadRef = useRef<HTMLElement>(null);
  const payloadToggle = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [openQueue, setOpenQueue] = useState(false);
  const queueToggle = useRef<HTMLButtonElement>(null);
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  const disabled = busy || invalid || !present;
  // A preview from another queue revision must not describe this card.
  const queueMatches = present && !invalid && queue?.[0]?.actionId === pending.action.id;
  const queueCount = queue === undefined ? pendingCount : queueMatches ? pendingCount ?? queue.length : 0;
  const entries = queueMatches ? queue!.slice(0, Math.min(20, queueCount ?? 20)) : [];
  const submitted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const hold = pending.decision.kind === "ask_hold";
  const paths = pending.action.paths ?? [];
  const recycle = pending.action.kind === "file_move" && pending.action.payload.startsWith("recycle:");
  const command = pending.action.kind === "shell" || pending.action.kind === "powershell";
  const showPayload = paths.length === 0 || command || pending.action.kind === "ui_click" || pending.action.kind === "ui_type";
  const explanation = pending.assistantExplanation ?? pending.whatHappens;
  const summaryTruncated = "summaryTruncated" in pending && pending.summaryTruncated === true;
  const summary = pending.action.summary ? visibleText(pending.action.summary) : null;
  const summarySuffix = summaryTruncated ? summary?.match(/\.\.\.\(\+\d+ more\)$/)?.[0] : undefined;
  const payload = visibleText(fullPayload ? pending.action.payload : pending.action.payload.replace(/^(?:[\t ]*\r?\n)+/, ""), true);
  const holdReason = !hold ? null : pending.decision.matchedRules.includes("host.bulk_recycle_hold")
    ? t("approval.holdBulk").replace("{count}", String(paths.length))
    : pending.decision.matchedRules.includes("host.after_never_block_hold") ? t("approval.holdAfterBlock") : null;
  const canAllow = pending.canAllowForTask === true;
  const grantReason = "grantUnavailableReason" in pending && typeof pending.grantUnavailableReason === "string"
    ? pending.grantUnavailableReason.trim() : "";
  const title = recycle ? t("approval.title.recycle") : t(`approval.title.${pending.action.kind}`);
  useEffect(() => {
    const element = payloadRef.current;
    if (!element) return;
    const measure = () => setPayloadOverflows(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [pending.action.payload, fullPayload]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (document.querySelector("dialog[open]")) return;
      heading.current?.focus({ preventScroll: true });
      const scroller = heading.current?.closest('[aria-label="Conversation"]');
      const card = heading.current?.closest('[role="alertdialog"]');
      if (scroller && card) {
        scroller.scrollTop += card.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function respond(choice: ApprovalChoice) {
    if (submitted.current || disabled) return;
    submitted.current = true; setBusy(true); setError(false);
    try {
      if (await getApi().respondApproval(choice, pending.action.id) === false) {
        const current = await getApi().getSnapshot();
        if (current.pendingApproval?.action.id !== pending.action.id) {
          setInvalid(true); setBusy(false); return;
        }
        throw new Error("Approval refused");
      }
      if (choice === "hold_confirmed") setConfirmed(true);
    }
    catch { submitted.current = false; setBusy(false); setError(true); }
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
      className="overflow-hidden rounded-2xl border border-lime/30 bg-paper-2 shadow-soft"
      data-testid="approval-card" role="alertdialog" aria-modal="false" aria-labelledby={`${id}-title`} aria-describedby={`${id}-skip`}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void respond("not_now"); } }}>
      <div className="p-5 md:p-7">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs font-semibold text-lime-deep"><ShieldCheck className="h-5 w-5" aria-hidden />{t("approval.eyebrow")}</span>
          <span className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${hold ? "border-danger/30 bg-danger/10 text-danger" : "border-lime/25 bg-lime/10 text-lime-deep"}`}>
            {t("approval.tier").replace("{tier}", String(pending.decision.tier))}
          </span>
        </div>
        <h2 id={`${id}-title`} ref={heading} tabIndex={-1} className="font-display rounded text-xl font-bold leading-snug tracking-tight text-ink [overflow-wrap:anywhere] md:text-2xl">
          {title}{paths.length > 1 && <span className="mt-1 block text-sm font-medium text-muted">{t("approval.items").replace("{count}", String(paths.length))}</span>}
        </h2>
        {queueCount === undefined && <p className="mt-2 text-xs leading-relaxed text-muted">{t("approval.queueUnknown")}</p>}
        {queueCount !== undefined && queueCount > 1 && <div className="mt-2" onKeyDown={(event) => {
          if (openQueue && event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); setOpenQueue(false); queueToggle.current?.focus();
          }
        }}>
          <button ref={queueToggle} type="button" aria-expanded={openQueue} aria-controls={`${id}-queue`} onClick={() => setOpenQueue(value => !value)}
            className="inline-flex min-h-11 items-center gap-2 rounded text-xs font-semibold text-lime-deep underline underline-offset-4">
            {t("approval.queueWaiting").replace("{count}", String(queueCount - 1))}<ChevronDown aria-hidden className={`h-3.5 w-3.5 ${openQueue ? "rotate-180" : ""}`} />
          </button>
          {openQueue && <div id={`${id}-queue`} className="rounded-xl border border-line bg-paper/70 p-4 text-xs leading-relaxed text-muted">
            <p className="mb-1 font-semibold text-ink">{t("approval.queueReview")}</p>
            <p>{t(entries.length ? "approval.queueViewOnly" : "approval.queuePreview")}</p>
            {entries.length > 0 && <p id={`${id}-queue-keys`} className="mt-2 text-[11px]">{t("approval.queueKeys")}</p>}
            {entries.length > 0 && <ol aria-label={t("approval.queueLabel")} aria-describedby={`${id}-queue-keys`} className="mt-3 max-h-72 space-y-2 overflow-y-auto overscroll-contain p-1"
              onKeyDown={(event) => {
                const row = (event.target as HTMLElement).closest("li");
                if (!row) return;
                const rows = Array.from(event.currentTarget.children) as HTMLElement[];
                const index = rows.indexOf(row);
                const next = event.key === "ArrowDown" ? Math.min(index + 1, rows.length - 1)
                  : event.key === "ArrowUp" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : -1;
                if (next >= 0) { event.preventDefault(); rows[next]?.focus(); }
              }}>
              {entries.map((entry, index) => <li key={entry.actionId} tabIndex={0} aria-current={index === 0 ? "step" : undefined}
                className={`rounded-lg border p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime ${index === 0 ? "border-lime/25 bg-lime/5" : "border-line bg-paper-2/50"}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-ink-soft">{index === 0 ? t("approval.queueCurrent") : t("approval.queuePosition").replace("{position}", String(index + 1))}</span>
                  <span className={`rounded-full border px-2 py-0.5 ${entry.tier >= 3 ? "border-danger/30 text-danger" : "border-line text-muted"}`}>{t("approval.tier").replace("{tier}", String(entry.tier))}</span>
                </div>
                <p data-testid="approval-queue-summary" dir="ltr" className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink [overflow-wrap:anywhere] [unicode-bidi:isolate]">{visibleText(entry.summary)}</p>
                {entry.canAllowForTask === true && <p className="mt-2 text-[11px] text-lime-deep">{t("approval.queueCanAllow")}</p>}
              </li>)}
            </ol>}
            {entries.length > 0 && queueCount! > entries.length && <p className="mt-3 text-xs text-muted" role="status">
              {t("approval.queueRemaining").replace("{count}", String(queueCount! - entries.length))}
            </p>}
          </div>}
        </div>}
        {summary && <div className="mt-4 rounded-xl border border-line bg-paper/70 p-4">
          <p className="mb-2 text-xs font-semibold text-ink-soft">{t("approval.summary")}</p>
          <p data-testid="approval-summary" dir="ltr" className="max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink [overflow-wrap:anywhere] [unicode-bidi:isolate]">{summarySuffix ? summary.slice(0, -summarySuffix.length) : summary}</p>
        </div>}
        {summaryTruncated && <p data-testid="approval-summary-truncated" className="mt-2 text-xs leading-relaxed text-muted">
          {summarySuffix ? t("approval.truncatedCount").replace("{marker}", summarySuffix) : t("approval.truncated")}
        </p>}
        {holdReason && <p className="mt-4 rounded-xl border border-lime/20 bg-lime/5 p-3 text-sm leading-relaxed text-ink-soft">{holdReason}</p>}
        {paths.length > 0 && <div className="mt-5 overflow-hidden rounded-xl border border-line bg-paper/70">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 text-xs font-semibold text-ink-soft">
            <span>{t("approval.targets")}</span>
            {paths.length === 1 && <span className="text-lime-deep">{t("approval.item")}</span>}
          </div>
          <ul className="max-h-36 divide-y divide-line overflow-y-auto overscroll-contain px-4">
            {paths.map((path, index) => <li key={`${index}-${path}`} className="flex items-start gap-2.5 py-3 text-xs leading-relaxed text-ink-soft">
              <File className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden /><span className="min-w-0 font-mono [overflow-wrap:anywhere]">{path}</span>
            </li>)}
          </ul>
          {recycle && <p className="border-t border-line px-4 py-2.5 text-xs text-lime-deep">{t("approval.recycle")}</p>}
        </div>}
        {(showPayload || summaryTruncated) && <div className="mt-4 rounded-xl border border-line bg-paper/70 p-4" onKeyDown={(event) => {
          if (summaryTruncated && fullPayload && event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); setFullPayload(false); payloadToggle.current?.focus();
          }
        }}>
          <p className="mb-2 text-xs font-semibold text-ink-soft">{t(command ? "approval.command" : "approval.payload")}</p>
          {(!summaryTruncated || fullPayload) && <code ref={payloadRef} data-testid="approval-payload" id={`${id}-payload`}
            role={summaryTruncated ? "region" : undefined} aria-label={summaryTruncated ? t("approval.fullCommand") : undefined}
            tabIndex={fullPayload ? 0 : undefined} dir="ltr"
            className={`whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink [overflow-wrap:anywhere] [unicode-bidi:isolate] ${fullPayload ? "block max-h-64 overflow-y-auto overscroll-contain" : "line-clamp-2"}`}>
            {payload}
          </code>}
          {(summaryTruncated || fullPayload || payloadOverflows) && <button ref={payloadToggle} type="button" aria-expanded={fullPayload} aria-controls={`${id}-payload`}
            onClick={() => setFullPayload((value) => !value)} className="mt-2 min-h-9 rounded text-xs font-semibold text-lime-deep hover:underline">
            {t(summaryTruncated ? fullPayload ? "approval.hideFullCommand" : "approval.showFullCommand" : fullPayload ? "approval.collapsePayload" : "approval.expandPayload")}
          </button>}
          {pending.action.cwd && <div className="mt-3 border-t border-line pt-3 text-xs text-muted">
            <p className="mb-1 font-semibold">{t("approval.cwd")}</p><code className="block whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{pending.action.cwd}</code>
          </div>}
        </div>}
        {explanation && <div className="mt-4 border-l-2 border-line pl-3 text-sm leading-relaxed text-muted">
          <p className="mb-1 text-xs font-semibold">{t("approval.explanation")}</p>
          <p data-testid="approval-what-happens">{explanation}</p>
        </div>}
        {(pending.undoNote || pending.decision.undoable) && <p className="mt-3 text-sm text-muted">{pending.undoNote ?? t("approval.undoable")}</p>}
        <button type="button" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded text-xs font-semibold text-muted hover:text-ink"
          aria-expanded={openDetails} aria-controls={`${id}-details`} onClick={() => setOpenDetails((v) => !v)}>
          <ChevronDown className={`h-4 w-4 transition ${openDetails ? "rotate-180" : ""}`} aria-hidden />
          {t(openDetails ? "approval.hideDetails" : "approval.showDetails")}
        </button>
        {openDetails && <pre id={`${id}-details`} className="max-h-44 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-paper p-3 font-mono text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">{pending.decision.details}</pre>}
        <div className="mt-4 flex flex-wrap gap-3">
          {hold ? <HoldConfirmation actionId={pending.action.id} disabled={disabled} onInvalid={() => setInvalid(true)} onConfirm={() => void respond("hold_confirmed")} /> :
            <PrimaryButton type="button" disabled={disabled} className="flex-1" onClick={() => void respond("do_it")} data-testid="approval-do-it">{t("approval.doIt")}</PrimaryButton>}
          <PrimaryButton type="button" tone="ghost" disabled={disabled} className="flex-1" onClick={() => void respond("not_now")} data-testid="approval-not-now">{t("approval.notNow")}</PrimaryButton>
        </div>
        {canAllow && <div className="mt-3">
          <button type="button" disabled={disabled} onClick={() => void respond("allow_for_task")}
            className="min-h-11 rounded text-sm font-semibold text-lime-deep underline underline-offset-4 disabled:opacity-50">{t("approval.allowTask")}</button>
          <p className="text-xs leading-relaxed text-muted">{t(command ? "approval.allowCommandScope" : pending.action.kind.startsWith("file_") ? "approval.allowFileScope" : "approval.allowScope")}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t("approval.manageGrants")}</p>
        </div>}
        {pending.canAllowForTask === false && <p data-testid="grant-unavailable" role="note" className="mt-3 text-xs leading-relaxed text-muted">
          {grantReason ? visibleText(grantReason) : t("approval.grantUnavailable")}
          {grantReason.includes("uses syntax Lalime can't check") && `${/[.!?]$/.test(grantReason) ? " " : ". "}${t("approval.approveOnce")}`}
        </p>}
        {invalid && <p role="status" className="mt-3 text-sm text-muted">{t("approval.invalid")}</p>}
        {error && !invalid && present && <p role="alert" className="mt-3 text-sm text-danger">{t("approval.error")}</p>}
        {confirmed && <div role="status" className="mt-3 rounded-xl border border-lime/25 bg-lime/5 p-3 text-sm text-lime-deep">
          <p className="flex items-center gap-2 font-semibold"><Check aria-hidden className="h-4 w-4" />{t("approval.confirmed")}</p>
          <div className="mt-2 overflow-hidden rounded-full bg-lime/10">
            <motion.div data-testid="approval-complete" className="h-1 origin-left rounded-full bg-lime"
              initial={reducedMotion ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: reducedMotion ? 0 : 0.28 }} />
          </div>
        </div>}
        {busy && !confirmed && <p role="status" className="mt-3 text-sm text-muted">{t("approval.sending")}</p>}
        <p id={`${id}-skip`} className="mt-4 text-xs leading-relaxed text-muted"><span className="block font-semibold text-ink-soft">{t("approval.notNowLabel")}</span><span>{t("approval.skipNote")}</span></p>
      </div>
    </motion.div>
  );
}
