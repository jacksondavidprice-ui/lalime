import { Check, Circle, LoaderCircle, Minus, X } from "lucide-react";
import type { RepairPlan } from "@shared/repair-plan";
import { visibleText } from "../../lib/visible-text";

// The host validates these labels. Keep command and path details out of this summary too.
function repairLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const label = value.trim();
  if (/^(?:sc|net|ping|tracert|nslookup|route|arp|taskkill|tasklist|netstat|del|erase|rmdir|rd|dir|call|start|copy|xcopy|robocopy|move|ren|rename|icacls|takeown|schtasks|wmic|bcdedit|diskpart|shutdown)\s+\S/i.test(label)) return undefined;
  if (/(?:[a-z]:[\\/]|\\|\S\/\S|(?:^|\s)\/[\w.]|\b(?:Add|Clear|Copy|Disable|Enable|Export|Format|Get|Import|Install|Invoke|Move|New|Open|Read|Register|Remove|Rename|Reset|Restart|Set|Start|Stop|Test|Uninstall|Update|Write)-\w+\b|[$`|;]|\.(?:exe|dll|sys|bat|cmd|ps1|sh|py|js|ts|json|txt|log|csv|md|docx?|xlsx?|pdf|png|jpe?g|zip|ini|xml|ya?ml|bak)(?:\s|$)|\b(?:powershell|pwsh|cmd|netsh|ipconfig|sfc|dism|chkdsk|reg|curl|wget|sudo|chmod|rm|echo|cat|python[23]?|node|npm|npx|bash|sh|git|winget)\s+[-/\w]|^(?:whoami|hostname|ipconfig|netstat|tasklist|pwd|ls|dir)$)/i.test(label)) return undefined;
  return visibleText(label).slice(0, 160);
}

const statusText: Record<RepairPlan["fixes"][number]["status"], string> = {
  pending: "Pending", trying: "Trying", worked: "Worked", failed: "Failed", skipped: "Skipped", declined: "You said no",
};
const causeText: Record<RepairPlan["causes"][number]["likelihood"], string> = {
  likely: "Likely", possible: "Possible", ruled_out: "Ruled out",
};
const rank = { likely: 0, possible: 1, ruled_out: 2 };

export function RepairChecklist({ plan }: { plan: RepairPlan }) {
  const causes = [...plan.causes].sort((a, b) => rank[a.likelihood] - rank[b.likelihood]);
  return (
    <section aria-label="Repair checklist" className="my-5 min-w-0 overflow-hidden rounded-xl border border-line bg-surface/40 p-4" data-testid="repair-checklist">
      <p className="mb-3 text-[11px] text-muted">Lalime's assessment</p>
      <div className="min-w-0 border-b border-line pb-3">
        <h3 className="eyebrow mb-1">Symptom</h3>
        <p className="break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{repairLabel(plan.symptom) ?? "Symptom details unavailable"}</p>
      </div>
      <div className="pt-3">
        <h3 className="eyebrow mb-2">Possible causes</h3>
        {causes.length === 0 ? <p className="text-xs text-muted">No cause identified yet</p> : (
          <ul className="space-y-3" aria-live="polite" aria-relevant="text">
            {causes.map((cause, index) => {
              const evidence = repairLabel(cause.evidence);
              return (
                <li key={index} data-testid="repair-cause" className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <p className={`min-w-0 break-words text-sm [overflow-wrap:anywhere] ${cause.likelihood === "ruled_out" ? "text-muted line-through" : "text-ink"}`}>{repairLabel(cause.label) ?? "Cause details unavailable"}</p>
                    <span className="text-[11px] text-muted">{causeText[cause.likelihood]}</span>
                  </div>
                  {evidence && <p className="mt-0.5 break-words text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">{evidence}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="eyebrow mb-2">Fixes tried</h3>
        {plan.fixes.length === 0 ? <p className="text-xs text-muted">No fixes tried yet</p> : (
          <ol className="space-y-3" aria-live="polite" aria-relevant="text">
            {plan.fixes.map((fix, index) => {
              const Icon = fix.status === "trying" ? LoaderCircle : fix.status === "worked" ? Check : fix.status === "failed" ? X : fix.status === "pending" ? Circle : Minus;
              const cause = repairLabel(fix.cause);
              return (
                <li key={index} data-testid="repair-fix" aria-current={fix.status === "trying" ? "step" : undefined} className="flex min-w-0 gap-2.5">
                  <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${fix.status === "trying" ? "animate-spin motion-reduce:animate-none text-lime" : fix.status === "worked" ? "text-lime" : fix.status === "failed" ? "text-amber-300" : "text-muted"}`} />
                  <div className="min-w-0">
                    <p className="break-words text-sm [overflow-wrap:anywhere]">{repairLabel(fix.label) ?? "Fix details unavailable"}</p>
                    <p className="text-[11px] text-muted">{statusText[fix.status]}</p>
                    {cause && <p className="mt-0.5 break-words text-xs text-muted [overflow-wrap:anywhere]">For: {cause}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
