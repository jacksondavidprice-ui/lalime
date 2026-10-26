import { useEffect, useRef } from "react";
import { CheckCircle2, CircleHelp, Wifi } from "lucide-react";
import type { ConnectionStatus } from "../lib/connection";
import { visibleText } from "../lib/visible-text";
import { t } from "../copy";

export function ConnectionPanel({ connection, signedIn, checking, failure, busy, onRetry, onPick }: {
  connection?: ConnectionStatus; signedIn: boolean; checking: boolean; failure?: string; busy: boolean;
  onRetry(): void; onPick(prompt: string): void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const state = failure ? "failed" : checking ? "checking" : connection?.state;
  const ready = state === "ready" && signedIn;
  const title = ready ? t("connection.ready") : state === "failed" ? t("connection.failed")
    : state === "checking" || signedIn ? t("connection.checking") : t("connection.signedOut");
  const Icon = ready ? CheckCircle2 : state === "failed" ? CircleHelp : Wifi;
  useEffect(() => { panel.current?.scrollIntoView({ block: "nearest" }); }, [title]);
  return <div ref={panel} data-testid="connection-panel" className={`rounded-xl border p-4 ${ready ? "border-lime/30 bg-lime/5" : "border-line bg-surface/40"}`}>
    <div role="status" aria-live="polite" aria-atomic="true">
      <p className={`flex items-center gap-2 font-semibold ${ready ? "text-lime" : "text-ink"}`}><Icon className="h-4 w-4 shrink-0" aria-hidden />{title}</p>
      {state === "failed" ? <p className="mt-2 leading-relaxed text-muted">{visibleText(failure || (connection?.state === "failed" ? connection.reason : undefined) || t("connection.failureFallback"))}</p>
        : !ready && <p className="mt-2 leading-relaxed text-muted">{state === "checking" ? t("connection.checkingHint") : signedIn ? t("connection.unverified") : t("connection.signInHint")}</p>}
      {ready && <dl className="mt-3 space-y-1 text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
        {connection?.account && <div><dt className="inline">{t("connection.account")} </dt><dd className="inline text-ink-soft">{visibleText(connection.account)}</dd></div>}
        {connection?.plan && <div><dt className="inline">{t("connection.plan")} </dt><dd className="inline text-ink-soft">{visibleText(connection.plan)}</dd></div>}
        <div><dt className="inline">{t("connection.model")} </dt><dd className="inline text-ink-soft">{visibleText(connection?.model || t("connection.defaultModel"))}</dd></div>
      </dl>}
    </div>
    {ready && <div className="mt-4 space-y-2"><p className="text-xs text-muted">{t("connection.exampleHint")}</p><div className="flex flex-wrap gap-2">
      {[t("connection.wifi"), t("connection.printer"), t("connection.disk")].map(prompt => <button key={prompt} type="button" disabled={busy} onClick={() => onPick(prompt)} className="min-h-10 rounded-lg border border-lime/20 bg-paper/50 px-3 py-2 text-left text-xs font-semibold text-ink enabled:hover:border-lime/50 disabled:opacity-45">{prompt}</button>)}
    </div></div>}
    {(state === "failed" || (signedIn && !connection && !checking)) && <button type="button" disabled={busy} onClick={onRetry} className="mt-3 min-h-10 rounded-lg border border-line px-4 font-semibold text-lime disabled:opacity-45">{t("connection.retry")}</button>}
  </div>;
}
