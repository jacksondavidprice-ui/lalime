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
  {
    id: "writer",
    eyebrow: "Optional",
    title: t("onboarding.writer.title"),
    body: t("onboarding.writer.body"),
  },
] as const;

export function Onboarding() {
  const [index, setIndex] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [writerMsg, setWriterMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slide = slides[index];
  const signInSlide = slide.id === "start";
  const writerSlide = slide.id === "writer";
  const last = index === slides.length - 1;

  async function finishWithChatgpt(): Promise<void> {
    setBusy(true);
    setAuthMsg(null);
    try {
      const r = await getApi().signInChatgpt();
      if (!r.ok) {
        setAuthMsg(
          r.message ??
            "ChatGPT sign-in needs the Codex CLI. Install it, run codex login once, or use an API key below.",
        );
        return;
      }
      setIndex((i) => Math.min(i + 1, slides.length - 1));
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
        setAuthMsg(r.message ?? "API key sign-in failed. Check the key and that Codex is installed.");
        return;
      }
      setIndex((i) => Math.min(i + 1, slides.length - 1));
    } finally {
      setBusy(false);
    }
  }

  async function saveWriterAndFinish(): Promise<void> {
    setBusy(true);
    setWriterMsg(null);
    try {
      if (anthropicKey.trim()) {
        const r = await getApi().writerSetKey(anthropicKey);
        if (!r.ok) {
          setWriterMsg(r.message ?? "Could not save that Anthropic key.");
          return;
        }
      }
      await getApi().completeOnboarding();
    } finally {
      setBusy(false);
    }
  }

  async function skipWriterAndFinish(): Promise<void> {
    setBusy(true);
    try {
      await getApi().completeOnboarding();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="relative mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-10 md:px-10 md:py-14"
      data-testid="onboarding"
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-24 h-64 w-64 -translate-x-1/2 rounded-full bg-lime/20 blur-3xl"
        animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.85, 0.5] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative flex items-center justify-between">
        <Logo size="lg" />
        <p className="text-sm font-medium text-ink/45">
          {index + 1} / {slides.length}
        </p>
      </div>

      <div className="relative flex flex-1 flex-col justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-xl"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ink/40">
              {slide.eyebrow}
            </p>
            <h1 className="font-display mt-4 text-[2.5rem] font-extrabold leading-[1.02] tracking-tight text-ink md:text-6xl">
              {slide.title}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-ink/65 md:text-xl md:leading-relaxed">
              {slide.body}
            </p>
          </motion.div>
        </AnimatePresence>

        {signInSlide && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="mt-10 flex max-w-xl flex-col gap-3"
            data-testid="sign-in-panel"
          >
            <PrimaryButton
              className="px-6 py-3.5 text-lg"
              disabled={busy}
              onClick={() => void finishWithChatgpt()}
              data-testid="sign-in-chatgpt"
            >
              Sign in with ChatGPT
            </PrimaryButton>
            <button
              type="button"
              className="self-start text-sm font-semibold text-ink/45 underline-offset-2 hover:underline"
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
                  className="flex-1 rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-base outline-none focus:border-ink/25"
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
            <p className="text-sm text-ink/45">
              One-time setup on this PC: install Codex (`npm i -g @openai/codex`), then run{" "}
              <span className="font-mono text-ink/60">codex login</span> — or skip that and paste an
              API key above.
            </p>
          </motion.div>
        )}

        {writerSlide && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="mt-10 flex max-w-xl flex-col gap-3"
            data-testid="writer-onboarding"
          >
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder={t("settings.writerPlaceholder")}
              className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-base outline-none focus:border-ink/25"
              data-testid="onboarding-anthropic-key"
              autoComplete="off"
            />
            {writerMsg && (
              <p className="whitespace-pre-wrap text-sm text-danger" data-testid="writer-onboarding-msg">
                {writerMsg}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <PrimaryButton
                className="px-6 py-3.5 text-lg"
                disabled={busy}
                onClick={() => void saveWriterAndFinish()}
                data-testid="onboarding-writer-continue"
              >
                {anthropicKey.trim() ? "Save and continue" : "Continue without a key"}
              </PrimaryButton>
              {anthropicKey.trim() && (
                <PrimaryButton
                  tone="ghost"
                  className="px-6 py-3.5 text-lg"
                  disabled={busy}
                  onClick={() => void skipWriterAndFinish()}
                  data-testid="onboarding-writer-skip"
                >
                  Skip
                </PrimaryButton>
              )}
            </div>
          </motion.div>
        )}
      </div>

      <div className="relative flex items-center justify-between gap-4">
        <div className="flex gap-2">
          {slides.map((s, i) => (
            <motion.span
              key={s.id}
              className={`h-2 rounded-full ${i === index ? "w-6 bg-ink" : "w-2 bg-ink/20"}`}
              layout
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
            />
          ))}
        </div>
        <div className="flex gap-2">
          {index > 0 && !writerSlide && (
            <PrimaryButton tone="ghost" onClick={() => setIndex((i) => i - 1)}>
              Back
            </PrimaryButton>
          )}
          {!signInSlide && !writerSlide && !last && (
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
  );
}
