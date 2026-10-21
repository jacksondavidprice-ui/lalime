import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Shield } from "lucide-react";
import type { PendingApproval } from "@shared/types";
import { t } from "../copy";
import { PrimaryButton } from "./PrimaryButton";
import { getApi } from "../lib/bridge";

export function ApprovalCard({ pending }: { pending: PendingApproval }) {
  const [openDetails, setOpenDetails] = useState(false);
  const hold = pending.decision.kind === "ask_hold";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className="overflow-hidden rounded-[28px] border border-ink/[0.06] bg-white shadow-soft"
      data-testid="approval-card"
    >
      <div className="relative overflow-hidden px-6 pb-6 pt-6 md:px-7">
        <motion.div
          aria-hidden
            className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-lime/35 blur-2xl"
          animate={{ opacity: [0.45, 0.75, 0.45] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="relative flex items-start gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[20px] bg-lime text-ink shadow-[0_10px_30px_rgba(142,212,12,0.38)]">
            <Shield className="h-7 w-7" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink/40">
              Guardian needs your OK
            </p>
            <h2 className="font-display mt-2 text-[1.35rem] font-extrabold leading-[1.2] tracking-tight text-ink md:text-[1.6rem]">
              {pending.decision.plainEnglish}
            </h2>
            {pending.whatHappens && (
              <p className="mt-2 text-base text-ink/65" data-testid="approval-what-happens">
                {pending.whatHappens}
              </p>
            )}
            {(pending.undoNote || pending.decision.undoable) && (
              <p className="mt-2 text-base text-ink/60">
                {pending.undoNote ?? t("approval.undoable")}
              </p>
            )}
            {hold && (
              <p className="mt-2 text-base text-ink/60">{t("approval.hold")}</p>
            )}

            <button
              type="button"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink/50 transition hover:text-ink"
              onClick={() => setOpenDetails((v) => !v)}
            >
              <ChevronDown
                className={`h-4 w-4 transition ${openDetails ? "rotate-180" : ""}`}
              />
              {openDetails ? "Hide details" : "Show details"}
            </button>
            {openDetails && (
              <pre className="font-mono mt-2 overflow-x-auto rounded-2xl bg-ink/[0.04] p-3 text-xs leading-relaxed text-ink/75">
                {pending.decision.details}
              </pre>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <PrimaryButton
                className="min-w-[120px] px-6 py-3.5 text-lg"
                onClick={() => void getApi().respondApproval("do_it")}
                data-testid="approval-do-it"
              >
                Do it
              </PrimaryButton>
              <PrimaryButton
                tone="ghost"
                className="px-5 py-3.5 text-lg"
                onClick={() => void getApi().respondApproval("not_now")}
                data-testid="approval-not-now"
              >
                Not now
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
