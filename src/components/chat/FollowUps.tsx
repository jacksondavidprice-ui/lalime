import { ArrowUpRight } from "lucide-react";
import type { ActivityEntry } from "@shared/types";
import { t } from "../../copy";

export function FollowUps({ activity, onPick }: { activity?: ActivityEntry; onPick: (prompt: string) => void }) {
  const options = [
    { label: t("followups.explain"), prompt: t("followups.explain") },
    { label: t("followups.next"), prompt: t("followups.next") },
    ...(activity ? [{ label: t("followups.activity"), prompt: `${t("followups.activityPrompt")}\n\n${activity.summary}` }] : []),
  ];
  return (
    <section aria-label={t("followups.label")} className="mt-5 border-t border-line pt-4">
      <p className="eyebrow mb-2">{t("followups.label")}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(({ label, prompt }) => (
          <button key={label} type="button" onClick={() => onPick(prompt)} data-testid="follow-up-chip" className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-line bg-surface/50 px-3 py-2 text-left text-xs text-muted transition hover:border-lime/30 hover:text-ink">
            {label}<ArrowUpRight className="h-3 w-3 shrink-0 text-lime" aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}
