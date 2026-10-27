import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Logo } from "../components/Logo";
import { PrimaryButton } from "../components/PrimaryButton";
import { t } from "../copy";
import { getApi } from "../lib/bridge";

const slides = [
  {
    id: "welcome",
    eyebrow: "Welcome",
    title: t("onboarding.welcome.title"),
    body: t("onboarding.welcome.body"),
  },
  {
    id: "guardian",
    eyebrow: "Guardian",
    title: t("onboarding.guardian.title"),
    body: t("onboarding.guardian.body"),
  },
  {
    id: "start",
    eyebrow: "Sign in",
    title: t("onboarding.signin.title"),
    body: t("onboarding.signin.body"),
  },
] as const;

export function Onboarding() {
  const [index, setIndex] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slide = slides[index];
  const signInSlide = slide.id === "start";
  const last = index === slides.length - 1;

  async function finishWithChatgpt(): Promise<void> {
    setBusy(true);
    setAuthMsg(null);
    try {
      const r = await getApi().signInChatgpt();
      if (!r.ok) {
        setAuthMsg(
          r.message ??
            t("errors.codexMissing"),
        );
        return;
      }
      await getApi().completeOnboarding();
    } finally {
      setBusy(false);
    }
  }

  async function finishWithKey(): Promise<void> {
    setBusy(true);
    setAuthMsg(null);
    try {
      const r = await getApi().signInApiKey(apiKey);
      if (!r.ok) {
        setAuthMsg(r.message ?? t("signin.apiError"));
        return;
      }
      await getApi().completeOnboarding();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="onboarding-layout relative h-full w-full overflow-y-auto"
      data-testid="onboarding"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col px-6 py-7 sm:px-10 lg:px-16 lg:py-10">
        <div className="relative flex shrink-0 items-center justify-between gap-6">
          <Logo size="lg" />
          <p className="rounded-full border border-ink/10 bg-surface px-4 py-2 font-mono text-xs tracking-[0.12em] text-ink/55">
            <span className="text-lime">0{index + 1}</span> / 0{slides.length}
          </p>
        </div>

      <div className={`grid flex-1 items-center gap-12 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 ${signInSlide ? "md:py-8" : "md:py-14"}`}>
          <div className="relative flex min-w-0 flex-col justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={slide.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="max-w-xl"
              >
                <p className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.22em] text-lime">
                  <span className="h-px w-7 bg-lime" aria-hidden />
                  {slide.eyebrow}
                </p>
            <h1 className={`font-display mt-6 font-extrabold leading-[1.08] tracking-[-0.055em] text-ink ${signInSlide ? "text-[2.1rem] sm:text-[2.5rem] xl:text-[2.8rem]" : "text-[2.65rem] sm:text-5xl xl:text-[3.8rem]"}`}>
                  {slide.title}
                </h1>
            <p className={`mt-5 max-w-[31rem] text-base leading-[1.8] text-muted ${signInSlide ? "" : "sm:text-lg"}`}>
                  {slide.body}
                </p>
              </motion.div>
            </AnimatePresence>

            {signInSlide && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="mt-8 flex max-w-xl flex-col gap-4"
                data-testid="sign-in-panel"
              >
                <PrimaryButton
                  className="px-6 py-3.5 text-base"
                  disabled={busy}
                  onClick={() => void finishWithChatgpt()}
                  data-testid="sign-in-chatgpt"
                >
                  Sign in with ChatGPT
                </PrimaryButton>
                <button
                  type="button"
                  className="rounded self-start text-sm font-medium text-ink/65 underline-offset-4 transition-colors hover:text-lime hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
                  onClick={() => setShowKey((v) => !v)}
                  data-testid="toggle-api-key"
                >
                  {showKey ? "Hide API key option" : "Use your own API key instead"}
                </button>
                {showKey && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                  aria-label="OpenAI API key"
                  className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-surface px-4 py-3 text-base text-ink outline-none placeholder:text-muted focus:border-lime/60 focus:ring-2 focus:ring-lime/10"
                      data-testid="api-key-input"
                      autoComplete="off"
                    />
                    <PrimaryButton
                      tone="ghost"
                      disabled={busy}
                      onClick={() => void finishWithKey()}
                      data-testid="continue-api-key"
                    >
                      Continue with key
                    </PrimaryButton>
                  </div>
                )}
                {authMsg && (
                  <p className="whitespace-pre-wrap text-sm text-danger" data-testid="auth-error">
                    {authMsg}
                  </p>
                )}
            <p className="rounded-xl border border-ink/8 bg-surface/60 p-4 text-xs leading-relaxed text-muted">
              {t("signin.setup")}
            </p>
            <PrimaryButton tone="ghost" disabled={busy} onClick={() => void getApi().completeOnboarding()}>
              Choose another provider or local model
            </PrimaryButton>
              </motion.div>
            )}
            <div className="relative mt-10 flex items-center justify-between gap-4 border-t border-ink/10 pt-6 sm:mt-12">
              <div className="flex gap-2" aria-hidden>
                {slides.map((s, i) => (
                  <motion.span
                    key={s.id}
                    className={`h-1 rounded-full ${i === index ? "w-8 bg-lime" : i < index ? "w-4 bg-lime/35" : "w-4 bg-ink/15"}`}
                    layout
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                {index > 0 && (
                  <PrimaryButton tone="ghost" onClick={() => setIndex((i) => i - 1)}>
                    Back
                  </PrimaryButton>
                )}
                {!signInSlide && !last && (
                  <PrimaryButton
                    className="px-6"
                    onClick={() => setIndex((i) => i + 1)}
                    data-testid="onboarding-next"
                  >
                    Continue
                  </PrimaryButton>
                )}
              </div>
            </div>
          </div>

          <div
            className="onboarding-art pointer-events-none relative hidden aspect-[0.94] max-h-[590px] w-full overflow-hidden rounded-[28px] border border-ink/10 bg-[#1b1b1b] lg:flex lg:items-center lg:justify-center"
            aria-hidden
          >
            <div
              className="absolute inset-0 opacity-35"
              style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "32px 32px" }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#1b1b1b_85%)]" />
            <div className="absolute left-7 top-7 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
              <span className="h-1.5 w-1.5 rounded-full bg-lime" />
              Lalime
            </div>
            <div className="absolute right-7 top-7 font-mono text-[10px] tracking-widest text-ink/25">0{index + 1} / 0{slides.length}</div>
            <div className="absolute h-[66%] w-[75%] rounded-full border border-lime/10" />
            <div className="absolute h-[46%] w-[52%] rounded-full border border-lime/20" />
            <div className="absolute h-52 w-52 rounded-full bg-lime/10 blur-[65px]" />
            <div className="relative flex h-36 w-36 rotate-[-8deg] items-center justify-center rounded-[32px] border border-lime/25 bg-[#262626] shadow-[0_24px_80px_rgba(0,0,0,0.45)] xl:h-44 xl:w-44">
              <div className="rotate-[8deg]"><Logo size="hero" showWordmark={false} /></div>
            </div>
            <div className="absolute left-[11%] top-[32%] h-3 w-3 rounded-full border-[3px] border-[#1b1b1b] bg-lime shadow-[0_0_0_1px_rgba(43,197,5,0.25)]" />
            <div className="absolute bottom-[27%] right-[18%] h-2 w-2 rounded-full bg-lime/70" />
            <div className="absolute bottom-8 left-7 right-7 flex items-end justify-between border-t border-ink/10 pt-5">
              <div className="flex gap-1.5">
                {[12, 22, 16, 30, 20, 36, 26, 18, 28, 14].map((height, i) => (
                  <span key={i} className="w-1.5 self-end rounded-sm bg-lime/35" style={{ height }} />
                ))}
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/35">{slide.eyebrow}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
