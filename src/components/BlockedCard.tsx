import { motion } from "framer-motion";
import { ShieldOff } from "lucide-react";
import type { GuardianDecision } from "@shared/types";
import { t } from "../copy";
import { PrimaryButton } from "./PrimaryButton";
import { getApi } from "../lib/bridge";

export function BlockedCard({ decision }: { decision: GuardianDecision }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="overflow-hidden rounded-3xl border border-danger/20 bg-danger-soft shadow-soft"
      data-testid="blocked-card"
    >
      <div className="flex items-start gap-4 p-5 md:p-6">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-danger">
          <ShieldOff className="h-6 w-6" strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-danger/80">
            {t("blocked.eyebrow")}
          </p>
          <h2 className="mt-1 font-display text-xl font-bold leading-snug tracking-tight text-ink md:text-2xl">
            {decision.plainEnglish}
          </h2>
          <pre className="font-mono mt-3 overflow-x-auto rounded-2xl bg-white/70 p-3 text-xs text-ink/70">
            {decision.details}
          </pre>
          <div className="mt-5">
            <PrimaryButton tone="ink" onClick={() => void getApi().dismissBlocked()}>
              {t("blocked.gotIt")}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
