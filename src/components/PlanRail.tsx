import { Check, Circle, ListChecks, History, LoaderCircle, ShieldCheck } from "lucide-react";
import type { ActivityEntry, PlanStep } from "@shared/types";
import { TaskGrants } from "./TaskGrants";
import { t } from "../copy";

export function PlanRail({
  plan,
  activity,
}: {
  plan: PlanStep[];
  activity: ActivityEntry[];
}) {
  return (
    <aside aria-label="Plan and activity" className="flex min-h-0 w-full flex-1 flex-col gap-7 overflow-y-auto p-5 lg:p-6">
      <div className="flex items-center justify-between border-b border-line pb-5">
        <span className="text-sm font-semibold text-ink">Your workspace</span>
        <ListChecks className="h-4 w-4 text-muted" aria-hidden />
      </div>
      <section>
        <div className="flex items-center justify-between">
          <h2 className="eyebrow">Plan</h2>
          <span className="font-mono text-[10px] text-muted">{String(plan.length).padStart(2, "0")}</span>
        </div>
        {plan.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-ink/15 bg-ink/[0.02] p-4">
            <ListChecks className="mb-3 h-5 w-5 text-muted" aria-hidden />
            <p className="text-sm font-medium text-ink/80">A little help, step by step.</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">Steps will show up here when Lalime is working.</p>
          </div>
        ) : (
          <ol className="mt-4 space-y-3">
            {plan.map((step) => (
              <li key={step.id} className="flex items-start gap-3 rounded-lg py-1 text-sm leading-relaxed text-ink">
                <StepIcon status={step.status} />
                <span className={step.status === "done" ? "text-muted line-through" : ""}>
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="eyebrow">Activity</h2>
          <History className="h-3.5 w-3.5 text-muted" aria-hidden />
        </div>
        {activity.length === 0 ? (
          <p className="mt-4 text-sm leading-relaxed text-muted">Nothing changed yet.<br />You can follow the work here.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {activity.map((entry) => (
              <li
                key={entry.id}
                className="rounded-xl border border-line bg-surface/60 px-4 py-3 text-sm leading-relaxed text-ink [overflow-wrap:anywhere]"
                data-testid="activity-entry"
              >
                <p className={entry.undone ? "text-muted line-through" : ""}>{entry.summary}</p>
                {entry.undone && entry.undoResult?.status === "restored" && (
                  <p className="mt-1 text-sm font-medium text-ok" data-testid="undone-label">
                    {t("changes.restored")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <TaskGrants />
      <div className="mt-auto rounded-xl border border-lime/15 bg-lime/[0.035] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink/90"><ShieldCheck className="h-4 w-4 text-lime" aria-hidden /> Guardian</div>
        <p className="mt-2 text-xs leading-relaxed text-muted">You stay in control. Lalime asks before anything risky.</p>
      </div>
    </aside>
  );
}

function StepIcon({ status }: { status: PlanStep["status"] }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-lime text-on-lime">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (status === "running") {
    return <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-lime-deep" />;
  }
  return <Circle className="mt-0.5 h-5 w-5 shrink-0 text-mist" strokeWidth={2} />;
}
