import { Square } from "lucide-react";
import { t } from "../copy";
import { PrimaryButton } from "./PrimaryButton";

export function StoppedCard({ onContinue, onStartOver }: { onContinue: () => void; onStartOver: () => void }) {
  return (
    <section className="rounded-2xl border border-line bg-paper-2 p-5 md:p-6" data-testid="stopped-card">
      <div role="status">
        <h2 className="flex items-center gap-3 font-display text-lg font-bold text-ink"><Square className="h-4 w-4 shrink-0 text-muted" aria-hidden />{t("stopped.title")}</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">{t("stopped.body")}</p>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <PrimaryButton onClick={onContinue}>{t("stopped.continue")}</PrimaryButton>
        <PrimaryButton tone="ghost" onClick={onStartOver}>{t("stopped.startOver")}</PrimaryButton>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">{t("stopped.hint")}</p>
    </section>
  );
}
