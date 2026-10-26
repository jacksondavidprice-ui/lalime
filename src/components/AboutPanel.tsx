import { ExternalLink } from "lucide-react";
import { version } from "../../package.json";
import { t } from "../copy";
import { Logo } from "./Logo";

export function AboutPanel() {
  return (
    <section className="mt-8 border-t border-line pt-6" data-testid="about-panel" aria-labelledby="about-heading">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Logo size="md" />
        <span className="rounded-full border border-line px-3 py-1.5 font-mono text-[10px] text-muted">{t("about.version").replace("{version}", version)}</span>
      </div>
      <h3 id="about-heading" className="mt-5 font-display text-lg font-bold text-ink">{t("about.title")}</h3>
      <p className="mt-2 text-sm text-ink-soft">{t("about.author")}</p>
      <p className="mt-1 text-sm text-muted">{t("about.body")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
        <a href="https://github.com/jacksondavidprice-ui/lalime" target="_blank" rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded font-semibold text-lime-deep hover:underline">
          {t("about.source")}<ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
        <span className="text-muted">{t("about.license")}</span>
      </div>
    </section>
  );
}
