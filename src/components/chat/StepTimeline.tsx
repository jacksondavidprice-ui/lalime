import { Check, Circle, Minus } from "lucide-react";
import type { PlanStep } from "@shared/types";
import { t } from "../../copy";

export function StepTimeline({ plan }: { plan: PlanStep[] }) {
  if (!plan.length) return null;
  return (
    <section aria-label={t("timeline.title")} className="my-5 rounded-xl border border-line bg-surface/40 p-4" data-testid="step-timeline">
      <h3 className="eyebrow mb-4">{t("timeline.title")}</h3>
      <ol className="space-y-0" aria-live="polite" aria-relevant="text">
        {plan.map((step, index) => (
          <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0" aria-current={step.status === "running" ? "step" : undefined}>
            {index < plan.length - 1 && <span aria-hidden className="absolute bottom-0 left-[9px] top-5 w-px bg-line" />}
            <span aria-hidden className={`relative mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full ${step.status === "done" ? "bg-lime/15 text-lime" : step.status === "failed" ? "bg-amber-400/15 text-amber-300" : step.status === "running" ? "border border-lime/40 bg-lime/10 text-lime" : "text-muted"}`}>
              {step.status === "done" ? <Check className="h-3.5 w-3.5" /> : step.status === "skipped" ? <Minus className="h-3 w-3" /> : <Circle className="h-2 w-2 fill-current" />}
            </span>
            <div className="min-w-0 text-sm leading-relaxed">
              <p className={step.status === "running" ? "lalime-shimmer font-medium" : step.status === "done" || step.status === "skipped" ? "text-muted" : "text-ink"}>{step.label}</p>
              <p className={`text-[11px] ${step.status === "failed" ? "text-amber-300" : "text-muted"}`}>{t(`timeline.${step.status}`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
