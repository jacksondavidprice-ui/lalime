import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Menu, Settings2, X } from "lucide-react";
import { Logo } from "../components/Logo";
import { ApprovalCard } from "../components/ApprovalCard";
import { BlockedCard } from "../components/BlockedCard";
import { PlanRail } from "../components/PlanRail";
import { StopButton } from "../components/StopButton";
import { PrimaryButton } from "../components/PrimaryButton";
import { copy, t } from "../copy";
import { useAppStore } from "../lib/store";
import { getApi } from "../lib/bridge";

const SUGGESTIONS = [
  copy["chips.downloads"],
  copy["chips.forms"],
  copy["chips.programs"],
  copy["chips.wifi"],
];

function authLabel(auth: ReturnType<typeof useAppStore.getState>["auth"]): string {
  switch (auth.state) {
    case "signed_in":
      return auth.method === "chatgpt" ? "ChatGPT" : "API key";
    case "demo":
      return "Dev fixture";
    case "error":
      return "Sign in";
    case "signed_out":
      return "Sign in";
    default: {
      const _exhaustive: never = auth;
      return _exhaustive;
    }
  }
}

export function ChatHome() {
  const messages = useAppStore((s) => s.messages);
  const plan = useAppStore((s) => s.plan);
  const activity = useAppStore((s) => s.activity);
  const pendingApproval = useAppStore((s) => s.pendingApproval);
  const blockedNotice = useAppStore((s) => s.blockedNotice);
  const running = useAppStore((s) => s.running);
  const statusText = useAppStore((s) => s.statusText);
  const auth = useAppStore((s) => s.auth);
  const hands = useAppStore((s) => s.hands);
  const writer = useAppStore((s) => s.writer);

  const signedIn = auth.state === "signed_in" || auth.state === "demo";
  const handsMissing = hands.backend === "windows" && !hands.available;
  const [text, setText] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [writerMsg, setWriterMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingApproval, blockedNotice]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || running) return;
    if (!signedIn) {
      setSettingsOpen(true);
      setSettingsMsg(t("errors.signInRequired"));
      return;
    }
    const toSend = text;
    setText("");
    await getApi().sendMessage(toSend);
  }

  return (
    <div className="relative flex h-full" data-testid="chat-home">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 px-5 py-4 md:px-8">
            <Logo size="sm" />
            <div className="flex items-center gap-2 sm:gap-3">
              <span
                className="hidden rounded-full bg-white/80 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-ink/45 shadow-soft sm:inline"
                data-testid="mode-badge"
              >
                {authLabel(auth)}
              </span>
              <StopButton visible={running || !!pendingApproval} />
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-full bg-white/80 text-ink shadow-soft transition hover:bg-white"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                data-testid="settings-button"
              >
                <Settings2 className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-full bg-white/80 text-ink shadow-soft lg:hidden"
                onClick={() => setRailOpen(true)}
                aria-label="Open plan and activity"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-5 pb-4 md:px-6">
            {handsMissing && (
              <div
                className="mt-1 rounded-[22px] border border-danger/25 bg-danger-soft px-4 py-3 text-sm leading-relaxed text-ink"
                data-testid="hands-missing"
                role="status"
              >
                <p className="font-semibold text-danger">Computer control is off</p>
                <p className="mt-1 text-ink/70 whitespace-pre-wrap">
                  {hands.message ?? t("errors.handsMissing")}
                </p>
              </div>
            )}
            <div className="flex-1 space-y-5 overflow-y-auto py-2">
              {!signedIn && messages.length === 0 && !pendingApproval && !blockedNotice && (
                <SignInGate
                  error={auth.state === "error" ? auth.message : null}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onChatgpt={() => {
                    void (async () => {
                      setBusy(true);
                      const r = await getApi().signInChatgpt();
                      setBusy(false);
                      if (!r.ok) setSettingsMsg(r.message ?? "Sign-in failed");
                      else setSettingsMsg("Finish ChatGPT sign-in in your browser if a window opened.");
                    })();
                  }}
                  busy={busy}
                />
              )}

              {signedIn && messages.length === 0 && !pendingApproval && !blockedNotice && (
                <EmptyState
                  onPick={(s) => {
                    setText(s);
                  }}
                />
              )}

              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22 }}
                  className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-[24px] rounded-br-md bg-ink px-4 py-3 text-base leading-relaxed text-paper"
                        : "max-w-[92%] text-[1.05rem] leading-relaxed text-ink md:text-lg"
                    }
                    data-testid={m.role === "assistant" ? "assistant-reply" : "user-message"}
                  >
                    {m.role === "assistant" && (
                      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-ink/35">
                        Lalime
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </motion.div>
              ))}

              <AnimatePresence>
                {pendingApproval && <ApprovalCard pending={pendingApproval} />}
                {blockedNotice && <BlockedCard decision={blockedNotice} />}
              </AnimatePresence>

              <div ref={bottomRef} />
            </div>

            <p className="mb-2 text-center text-sm text-ink/40" data-testid="status-text">
              {statusText}
            </p>

            <form
              onSubmit={(e) => void onSubmit(e)}
              className="shadow-soft mb-3 flex items-end gap-2 rounded-[28px] border border-ink/[0.06] bg-white/95 p-2 backdrop-blur"
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={1}
                placeholder={
                  signedIn ? "What do you need help with?" : "Sign in to ask Lalime for help…"
                }
                className="max-h-40 min-h-[52px] flex-1 resize-none bg-transparent px-3 py-3.5 text-lg outline-none placeholder:text-ink/35"
                data-testid="chat-input"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onSubmit(e);
                  }
                }}
              />
              <button
                type="submit"
                disabled={!text.trim() || running}
                className="mb-1 mr-1 grid h-12 w-12 place-items-center rounded-full bg-lime text-ink transition enabled:hover:brightness-95 disabled:opacity-40"
                aria-label="Send"
                data-testid="chat-send"
              >
                <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </form>
          </div>
        </main>

        <div className="hidden w-[300px] shrink-0 border-l border-ink/[0.05] bg-white/40 lg:block">
          <PlanRail plan={plan} activity={activity} />
        </div>
      </div>

      <AnimatePresence>
        {railOpen && (
          <motion.div
            className="absolute inset-0 z-20 bg-ink/30 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setRailOpen(false)}
          >
            <motion.div
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              className="absolute inset-y-0 right-0 w-[min(100%,340px)] bg-paper shadow-soft"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-end p-3">
                <button
                  type="button"
                  className="grid h-10 w-10 place-items-center rounded-full bg-white"
                  onClick={() => setRailOpen(false)}
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <PlanRail plan={plan} activity={activity} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            className="absolute inset-0 z-30 grid place-items-center bg-ink/35 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSettingsOpen(false)}
            data-testid="settings-modal"
          >
            <motion.div
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
              className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-paper p-6 shadow-soft"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold text-ink">{t("settings.signInHeading")}</h2>
                <button
                  type="button"
                  className="grid h-9 w-9 place-items-center rounded-full bg-white"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 text-sm text-ink/55">{t("settings.signInBlurb")}</p>
              <div className="mt-5 flex flex-col gap-2">
                <PrimaryButton
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      const r = await getApi().signInChatgpt();
                      setBusy(false);
                      setSettingsMsg(
                        r.ok
                          ? "ChatGPT sign-in started — finish in your browser if needed."
                          : (r.message ?? "Failed"),
                      );
                    })();
                  }}
                  data-testid="settings-sign-in-chatgpt"
                >
                  Sign in with ChatGPT
                </PrimaryButton>
                <div className="mt-2 flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Your OpenAI API key (sk-…)"
                    className="flex-1 rounded-2xl border border-ink/10 bg-white px-3 py-2.5 text-sm outline-none"
                    autoComplete="off"
                    data-testid="settings-api-key"
                  />
                  <PrimaryButton
                    tone="ghost"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        const r = await getApi().signInApiKey(apiKey);
                        setBusy(false);
                        setSettingsMsg(r.ok ? "Signed in with your API key." : (r.message ?? "Failed"));
                        if (r.ok) setApiKey("");
                      })();
                    }}
                  >
                    Save
                  </PrimaryButton>
                </div>
                {settingsMsg && (
                  <p className="whitespace-pre-wrap text-sm text-ink/60" data-testid="settings-msg">
                    {settingsMsg}
                  </p>
                )}
              </div>

              <div className="mt-8 border-t border-ink/10 pt-6" data-testid="settings-writer">
                <h3 className="font-display text-lg font-bold text-ink">
                  {t("settings.writerHeading")}
                </h3>
                <p className="mt-2 text-sm text-ink/55">{t("settings.writerBlurb")}</p>
                <p className="mt-2 text-xs text-ink/40">
                  Get a key at{" "}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-ink/60 underline-offset-2 hover:underline"
                  >
                    console.anthropic.com
                  </a>
                  .
                </p>
                {writer.enabled && writer.keyHint && (
                  <p className="mt-3 text-sm text-ink/60" data-testid="writer-key-hint">
                    Saved key ending in {writer.keyHint}
                    {writer.encryptedAtRest === false ? " (kept for this session only)" : ""}.
                  </p>
                )}
                {writer.lastError && (
                  <p className="mt-2 text-sm text-ink/55" data-testid="writer-last-error">
                    {writer.lastError}
                  </p>
                )}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder={t("settings.writerPlaceholder")}
                    className="flex-1 rounded-2xl border border-ink/10 bg-white px-3 py-2.5 text-sm outline-none"
                    autoComplete="off"
                    data-testid="settings-anthropic-key"
                  />
                  <PrimaryButton
                    tone="ghost"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        const r = await getApi().writerSetKey(anthropicKey);
                        setBusy(false);
                        setWriterMsg(
                          r.ok ? t("settings.writerSaved") : (r.message ?? "Could not save that key."),
                        );
                        if (r.ok) setAnthropicKey("");
                      })();
                    }}
                    data-testid="settings-writer-save"
                  >
                    Save
                  </PrimaryButton>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <PrimaryButton
                    tone="ghost"
                    disabled={busy || !writer.enabled}
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        const r = await getApi().writerCheckKey();
                        setBusy(false);
                        setWriterMsg(r.ok ? t("settings.writerCheckOk") : (r.message ?? "Check failed."));
                      })();
                    }}
                    data-testid="settings-writer-check"
                  >
                    Check key
                  </PrimaryButton>
                  <PrimaryButton
                    tone="ghost"
                    disabled={busy || !writer.enabled}
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        await getApi().writerClearKey();
                        setBusy(false);
                        setWriterMsg(t("settings.writerRemoved"));
                      })();
                    }}
                    data-testid="settings-writer-clear"
                  >
                    Remove key
                  </PrimaryButton>
                </div>
                {writerMsg && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink/60" data-testid="writer-msg">
                    {writerMsg}
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SignInGate({
  error,
  onOpenSettings,
  onChatgpt,
  busy,
}: {
  error: string | null;
  onOpenSettings: () => void;
  onChatgpt: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex h-full flex-col justify-center py-10" data-testid="sign-in-gate">
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-display text-3xl font-extrabold tracking-tight text-ink md:text-[2.6rem] md:leading-[1.1]"
      >
        {t("gate.title")}
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="mt-3 max-w-md text-lg text-ink/55"
      >
        {t("gate.body")}
      </motion.p>
      {error && (
        <p className="mt-4 max-w-md whitespace-pre-wrap text-sm text-danger" data-testid="auth-error">
          {error}
        </p>
      )}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <PrimaryButton
          className="px-6 py-3.5 text-lg"
          disabled={busy}
          onClick={onChatgpt}
          data-testid="gate-sign-in-chatgpt"
        >
          Sign in with ChatGPT
        </PrimaryButton>
        <PrimaryButton tone="ghost" className="px-6 py-3.5 text-lg" onClick={onOpenSettings}>
          Use API key
        </PrimaryButton>
      </div>
      <p className="mt-6 max-w-md text-sm text-ink/45">
        Once on this PC: <span className="font-mono text-ink/55">npm i -g @openai/codex</span> then{" "}
        <span className="font-mono text-ink/55">codex login</span>. After that, the in-app button is
        enough.
      </p>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex h-full flex-col justify-center py-10" data-testid="empty-state">
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-display text-3xl font-extrabold tracking-tight text-ink md:text-[2.6rem] md:leading-[1.1]"
      >
        {t("empty.title")}
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="mt-3 max-w-md text-lg text-ink/55"
      >
        {t("empty.body")}
      </motion.p>
      <div className="mt-8 flex flex-col gap-3">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.04 }}
            onClick={() => onPick(s)}
            className="rounded-[22px] bg-white/85 px-4 py-3.5 text-left text-base text-ink shadow-soft transition hover:bg-white hover:shadow-[0_18px_40px_rgba(11,13,12,0.08)]"
            data-testid="suggestion-chip"
          >
            {s}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
