import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import type { GuardianDecision } from "@shared/types";
import { t } from "../copy";
import { PrimaryButton } from "./PrimaryButton";
import { getApi } from "../lib/bridge";
import { useAppStore } from "../lib/store";
import { visibleText } from "../lib/visible-text";

export function BlockedCard({ decision }: { decision: GuardianDecision }) {
  const running = useAppStore((s) => s.running);
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const sending = useRef(false);
  async function safer() {
    if (running || sending.current) return;
    sending.current = true; setBusy(true); setError(false);
    try {
      await getApi().sendMessage(t("blocked.saferPrompt"));
    } catch { setError(true); }
    finally { sending.current = false; setBusy(false); }
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="overflow-hidden rounded-2xl border border-lime/25 bg-paper-2 shadow-soft"
      data-testid="blocked-card"
    >
      <div className="flex items-start gap-4 p-5 md:p-6">
        <motion.div animate={reduced ? undefined : { scale: [1, 1.08, 1] }} transition={{ duration: 0.6 }}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-lime/25 bg-lime/10 text-lime-deep">
          <ShieldCheck className="h-6 w-6" strokeWidth={1.8} aria-hidden />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-relaxed text-lime-deep">
            {t("blocked.eyebrow")}
          </p>
          <h2 className="mt-1 font-display text-xl font-bold leading-snug tracking-tight text-ink md:text-2xl">
            {visibleText(decision.plainEnglish)}
          </h2>
          <details className="mt-4 text-muted">
            <summary className="cursor-pointer rounded py-2 text-xs font-semibold hover:text-ink">{t("blocked.details")}</summary>
            <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-paper p-3 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">{decision.details}</pre>
          </details>
          <div className="mt-4 flex flex-wrap gap-2">
            <PrimaryButton disabled={running || busy} onClick={() => void safer()}>{t("blocked.safer")}</PrimaryButton>
            <PrimaryButton tone="ghost" disabled={busy} onClick={() => {
              void getApi().dismissBlocked().catch(() => setError(true));
            }}>
              {t("blocked.gotIt")}
            </PrimaryButton>
          </div>
          {running && <p className="mt-3 text-xs leading-relaxed text-muted">{t("blocked.wait")}</p>}
          {error && <p role="alert" className="mt-3 text-sm text-danger">{t("blocked.error")}</p>}
        </div>
      </div>
    </motion.div>
  );
}
