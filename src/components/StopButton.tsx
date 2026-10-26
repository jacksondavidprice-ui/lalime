import { useState } from "react";
import { Square } from "lucide-react";
import { getApi } from "../lib/bridge";
import { t } from "../copy";
import { stopReadAloud } from "./chat/ReadAloudButton";

export function StopButton({ visible }: { visible: boolean }) {
  const [error, setError] = useState(false);
  if (!visible) return null;
  return (
    <div className="relative shrink-0">
    <button
      type="button"
      onClick={() => { stopReadAloud(); setError(false); void getApi().stop().catch(() => setError(true)); }}
      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger transition hover:bg-danger/20"
      data-testid="stop-button"
      title={t("stop.title")}
      aria-label={t("stop.title")}
    >
      <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
      <span className="text-left leading-tight">{t("stop.label")}<kbd className="mt-0.5 block font-mono text-[8px] font-normal sm:text-[10px]">{t("stop.shortcut")}</kbd></span>
    </button>
    {error && <p role="alert" className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-danger/30 bg-paper-2 p-3 text-sm text-danger">{t("stop.error")}</p>}
    </div>
  );
}
