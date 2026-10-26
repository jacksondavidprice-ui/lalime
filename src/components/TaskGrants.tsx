import { useId, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useAppStore } from "../lib/store";
import { getApi } from "../lib/bridge";
import { t } from "../copy";

export function TaskGrants() {
  const contextId = useId();
  const grants = useAppStore((state) => state.taskGrants);
  const pending = useRef(new Set<string>());
  const [busy, setBusy] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const revoke = getApi().revokeTaskGrant;
  async function revokeGrant(id: string) {
    if (!revoke || pending.current.has(id)) return;
    pending.current.add(id);
    setBusy([...pending.current]);
    setErrors((previous) => ({ ...previous, [id]: false }));
    try { if (!await revoke(id)) setErrors((previous) => ({ ...previous, [id]: true })); }
    catch { setErrors((previous) => ({ ...previous, [id]: true })); }
    finally { pending.current.delete(id); setBusy([...pending.current]); }
  }
  if (!grants?.length) return null;
  return <section data-testid="task-grants" className="rounded-xl border border-lime/20 bg-lime/[0.03] p-4">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><ShieldCheck className="h-4 w-4 text-lime" aria-hidden />{t("grants.title")}</h2>
    <p className="mt-2 text-xs leading-relaxed text-muted">{t("grants.scope")}</p>
    <ul className="mt-4 space-y-4">{grants.map((grant) => <li key={grant.id}>
      <p id={`${contextId}-${encodeURIComponent(grant.id)}`} className="font-mono text-xs leading-relaxed text-ink [overflow-wrap:anywhere]">{grant.target}</p>
      <button type="button" aria-describedby={`${contextId}-${encodeURIComponent(grant.id)}`} disabled={!revoke || busy.includes(grant.id)} onClick={() => void revokeGrant(grant.id)} className="mt-2 min-h-9 rounded-lg border border-line px-3 text-xs font-semibold text-muted enabled:hover:text-ink disabled:opacity-45">{t(busy.includes(grant.id) ? "grants.revoking" : "grants.revoke")}</button>
      {errors[grant.id] && <p role="alert" className="mt-2 text-xs text-amber-300">{t("grants.error")}</p>}
    </li>)}</ul>
    {!revoke && <p className="mt-3 text-xs text-muted">{t("grants.unavailable")}</p>}
  </section>;
}
