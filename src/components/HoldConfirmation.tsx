import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { t } from "../copy";
import { PrimaryButton } from "./PrimaryButton";
import { getApi } from "../lib/bridge";

/** Sustained input confirms on release. Reduced motion uses a separate confirmation. */
export function HoldConfirmation({ actionId, disabled, onConfirm, onInvalid }: { actionId: string; disabled: boolean; onConfirm: () => void; onInvalid: () => void }) {
  const prefersReduced = useReducedMotion();
  const [twoStep, setTwoStep] = useState(false);
  const reduced = prefersReduced || twoStep;
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef<number | null>(null);
  const source = useRef<string | null>(null);
  const pointer = useRef<number | null>(null);
  const duration = reduced ? 2000 : 1500;

  function reset(cancelHost = true) {
    generation.current++;
    if (cancelHost && source.current !== null) void getApi().cancelApprovalHold?.(actionId).catch(() => {});
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    started.current = null;
    source.current = null;
    pointer.current = null;
    setProgress(0); setActive(false); setReady(false);
  }
  function cancel() { reset(); }
  useEffect(() => {
    const hide = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hide);
    return () => {
      generation.current++;
      if (source.current !== null) void getApi().cancelApprovalHold?.(actionId).catch(() => {});
      if (timer.current !== null) clearInterval(timer.current);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => { cancel(); }, [disabled, reduced]);

  async function begin(input: string) {
    if (disabled || source.current !== null) return;
    source.current = input;
    const attempt = ++generation.current;
    setError(false);
    let accepted = false;
    try { accepted = await getApi().beginApprovalHold?.(actionId) === true; } catch { /* Keep confirmation unavailable. */ }
    if (generation.current !== attempt) return;
    if (!accepted) {
      let invalid = false;
      try { invalid = (await getApi().getSnapshot()).pendingApproval?.action.id !== actionId; } catch { /* A connection failure remains retryable. */ }
      if (generation.current !== attempt) return;
      reset();
      if (invalid) onInvalid(); else setError(true);
      return;
    }
    started.current = performance.now();
    setActive(true);
    timer.current = setInterval(() => {
      const elapsed = performance.now() - started.current!;
      setProgress(Math.min(1, elapsed / duration));
      if (elapsed >= duration) {
        clearInterval(timer.current!); timer.current = null;
        setReady(true);
      }
    }, 40);
  }
  function release(input: string) {
    if (source.current !== input) return;
    const complete = started.current !== null && performance.now() - started.current >= duration;
    reset(!complete || disabled);
    if (complete && !disabled) onConfirm();
  }
  function inside(button: HTMLButtonElement, x: number, y: number) {
    const bounds = button.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }
  const label = reduced ? ready ? t("approval.confirm") : t("approval.prepare") : t("approval.holdButton");
  const status = reduced
    ? ready ? t("approval.confirmReady") : t("approval.preparing").replace("{seconds}", String(Math.max(1, Math.ceil(2 * (1 - progress)))))
    : ready ? t("approval.holdReady") : t("approval.holdProgress");

  return (
    <div className="min-w-0 flex-1 basis-full">
      <PrimaryButton type="button" disabled={disabled} data-testid="approval-do-it"
        className="relative w-full select-none overflow-hidden touch-none px-5 py-3.5"
        onPointerDown={(event) => {
          if (!reduced && event.button === 0 && started.current === null) { pointer.current = event.pointerId; begin("pointer"); }
        }}
        onPointerMove={(event) => {
          if (pointer.current === event.pointerId && !inside(event.currentTarget, event.clientX, event.clientY)) cancel();
        }}
        onPointerUp={(event) => {
          if (!reduced && pointer.current === event.pointerId) {
            if (inside(event.currentTarget, event.clientX, event.clientY)) release("pointer"); else cancel();
          }
        }}
        onPointerLeave={(event) => { if (!reduced && pointer.current === event.pointerId) cancel(); }}
        onPointerCancel={(event) => { if (pointer.current === event.pointerId) cancel(); }} onBlur={cancel}
        onKeyDown={(event) => {
          if (reduced && event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
          if (!reduced && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault(); if (!event.repeat) begin(event.key);
          }
        }}
        onKeyUp={(event) => {
          if (!reduced && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); release(event.key); }
        }}
        onClick={(event) => {
          event.preventDefault();
          if (!reduced) return;
          if (ready) { reset(false); onConfirm(); } else void begin("armed");
        }}>
        {!reduced && <span aria-hidden className="pointer-events-none absolute inset-0 origin-left bg-black/15" style={{ transform: `scaleX(${progress})` }} />}
        <span className="relative">{label}</span>
        {!reduced && <svg aria-hidden className="relative h-5 w-5 -rotate-90" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} />
        </svg>}
      </PrimaryButton>
      <p className="mt-2 text-sm leading-relaxed text-muted">{reduced ? t("approval.prepareHint") : t("approval.holdHint")}</p>
      <p role="status" className="mt-1 min-h-5 text-sm font-semibold text-lime-deep">{active ? status : ""}</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{t("approval.holdUnavailable")}</p>}
      {!prefersReduced && <button type="button" disabled={disabled} aria-pressed={twoStep}
        onClick={() => { cancel(); setTwoStep((value) => !value); }}
        className="mt-1 min-h-9 rounded text-xs font-semibold text-ink-soft underline decoration-line underline-offset-4 hover:text-ink">
        {t("approval.twoStep")}
      </button>}
    </div>
  );
}
