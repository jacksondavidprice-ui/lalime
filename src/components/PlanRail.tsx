import { Check, Circle, LoaderCircle } from "lucide-react";
import type { ActivityEntry, PlanStep } from "@shared/types";
import { getApi } from "../lib/bridge";

export function PlanRail({
  plan,
  activity,
}: {
  plan: PlanStep[];
  activity: ActivityEntry[];
}) {
  return (
    <aside className="flex h-full w-full flex-col gap-8 overflow-y-auto p-5 md:p-6">
      <section>
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-ink/40">
          Plan
        </h2>
        {plan.length === 0 ? (
          <p className="mt-3 text-base text-ink/50">Steps will show up here when Lalime is working.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {plan.map((step) => (
              <li key={step.id} className="flex items-start gap-3 text-base text-ink">
                <StepIcon status={step.status} />
                <span className={step.status === "done" ? "text-ink/55 line-through" : ""}>
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-ink/40">
          Activity
        </h2>
        {activity.length === 0 ? (
          <p className="mt-3 text-base text-ink/50">Nothing changed yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {activity.map((entry) => (
              <li
                key={entry.id}
                className="rounded-2xl bg-white/70 px-4 py-3 text-base text-ink shadow-soft"
                data-testid="activity-entry"
              >
                <p className={entry.undone ? "text-ink/45 line-through" : ""}>{entry.summary}</p>
                {entry.undoable && !entry.undone && entry.actionId && (
                  <button
                    type="button"
                    className="mt-2 text-sm font-semibold text-ok underline-offset-2 hover:underline"
                    onClick={() => void getApi().undo(entry.id)}
                    data-testid="undo-button"
                  >
                    Undo
                  </button>
                )}
                {entry.undone && (
                  <p className="mt-1 text-sm font-medium text-ok" data-testid="undone-label">
                    Undone
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function StepIcon({ status }: { status: PlanStep["status"] }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-lime text-ink">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (status === "running") {
    return <LoaderCircle className="mt-0.5 h-5 w-5 animate-spin text-lime-deep" />;
  }
  return <Circle className="mt-0.5 h-5 w-5 text-mist" strokeWidth={2} />;
}
