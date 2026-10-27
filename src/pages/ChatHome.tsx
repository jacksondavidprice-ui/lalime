import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, ArrowUpRight, FolderOpen, LayoutGrid, ListChecks, Menu, Settings2, ShieldCheck, Wifi, X } from "lucide-react";
import { Logo } from "../components/Logo";
import { ApprovalCard } from "../components/ApprovalCard";
import { BlockedCard } from "../components/BlockedCard";
import { PlanRail } from "../components/PlanRail";
import { StopButton } from "../components/StopButton";
import { StoppedCard } from "../components/StoppedCard";
import { PrimaryButton } from "../components/PrimaryButton";
import { Modal } from "../components/Modal";
import { ProviderSettings } from "../components/ProviderSettings";
import { AboutPanel } from "../components/AboutPanel";
import { ChangeSummary } from "../components/ChangeSummary";
import { copy, t } from "../copy";
import { useAppStore } from "../lib/store";
import { getApi } from "../lib/bridge";
import { connectionFromSnapshot, connectionLabel } from "../lib/connection";
import { RichText } from "../components/chat/RichText";
import { WorkingIndicator } from "../components/chat/WorkingIndicator";
import { JumpToLatest } from "../components/chat/JumpToLatest";
import { CopyButton } from "../components/chat/CopyButton";
import { ReadAloudButton, stopReadAloud } from "../components/chat/ReadAloudButton";
import { RepairChecklist } from "../components/chat/RepairChecklist";
import { StepTimeline } from "../components/chat/StepTimeline";
import { FollowUps } from "../components/chat/FollowUps";
import { useStickToBottom } from "../components/chat/useStickToBottom";
import { useAutoGrow } from "../components/chat/useAutoGrow";

const SUGGESTIONS = [
  { prompt: copy["chips.downloads"], title: "Downloads", icon: FolderOpen },
  { prompt: copy["chips.forms"], title: "Forms", icon: ListChecks },
  { prompt: copy["chips.programs"], title: "Apps", icon: LayoutGrid },
  { prompt: copy["chips.wifi"], title: "Wi-Fi", icon: Wifi },
];

export function ChatHome() {
  const messages = useAppStore((s) => s.messages);
  const plan = useAppStore((s) => s.plan);
  const repairPlan = useAppStore((s) => s.repairPlan);
  const activity = useAppStore((s) => s.activity);
  const pendingApproval = useAppStore((s) => s.pendingApproval);
  const pendingApprovalCount = useAppStore((s) => s.pendingApprovalCount);
  const approvalQueue = useAppStore((s) => s.approvalQueue);
  const blockedNotice = useAppStore((s) => s.blockedNotice);
  const running = useAppStore((s) => s.running);
  const stopped = useAppStore((s) => s.stopped);
  const statusText = useAppStore((s) => s.statusText);
  const auth = useAppStore((s) => s.auth);
  const connection = useAppStore(connectionFromSnapshot);
  const connectionState = connectionLabel(auth, running, connection);
  const hands = useAppStore((s) => s.hands);
  const writer = useAppStore((s) => s.writer);

  const signedIn = auth.state === "signed_in" || auth.state === "demo";
  const handsMissing = hands.backend === "windows" && !hands.available;
  const [text, setText] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(!signedIn);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const sendingRef = useRef(false);
  const latestAssistantIndex = messages.reduce((latest, message, index) => message.role === "assistant" ? index : latest, -1);
  const latestUserIndex = messages.reduce((latest, message, index) => message.role === "user" ? index : latest, -1);
  const currentAnswerIndex = latestAssistantIndex > latestUserIndex ? latestAssistantIndex : -1;
  const canFollowUp = signedIn && !running && !pendingApproval && !sending;
  const lastRequest = latestUserIndex >= 0 ? messages[latestUserIndex].content : "";
  const canRecall = canFollowUp && text.length === 0 && lastRequest.length > 0;
  const hasConversation = messages.length > 0 || !!pendingApproval || !!blockedNotice || stopped || running || !!repairPlan || plan.length > 0 || activity.length > 0;
  const { ref: scrollRef, atBottom, unseen, scrollToBottom } = useStickToBottom<HTMLDivElement>(hasConversation && !pendingApproval);
  const inputRef = useAutoGrow(text);
  // Messages already on screen when the chat opens don't replay their entrance.
  const historyIds = useRef<Set<string> | null>(null);
  if (historyIds.current === null) historyIds.current = new Set(messages.map((m) => m.id));

  useEffect(() => {
    if (signedIn) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pin to the newest content once there is a conversation; the welcome stays at the top.
  useEffect(() => {
    if (hasConversation && !pendingApproval) scrollToBottom("auto");
  }, [hasConversation, pendingApproval?.action.id, scrollToBottom]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (settingsOpen || railOpen) return;
      if (e.key === "Escape" && running) {
        e.preventDefault();
        stopReadAloud();
        void getApi().stop();
        return;
      }
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (!typing && (e.key === "/" || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)))) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, settingsOpen, railOpen, inputRef]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || running || pendingApproval || sendingRef.current) return;
    if (!signedIn) {
      setSettingsOpen(true);
      setSettingsMsg(t("errors.signInRequired"));
      return;
    }
    const toSend = text;
    setText("");
    if (!await send(toSend)) setText((current) => current || toSend);
  }

  async function send(message: string): Promise<boolean> {
    if (!signedIn || running || pendingApproval || sendingRef.current) return false;
    sendingRef.current = true;
    setSending(true);
    setSendError(false);
    try {
      await getApi().sendMessage(message);
      return true;
    } catch {
      setSendError(true);
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function pickFollowUp(prompt: string) {
    setText(prompt);
    inputRef.current?.focus();
  }

  return (
    <div className="relative flex h-full" data-testid="chat-home">
      <div className="mx-auto flex h-full w-full max-w-[1600px] flex-1">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4 md:px-8">
            <div className="flex shrink-0 flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-4"><Logo size="sm" />
              <span data-testid="connection-status" role="status" aria-live="polite" aria-label={"Connection: " + connectionState}
                className="inline-flex h-6 w-24 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface/50 text-[11px] text-muted">
                <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + (connectionState === "Ready" ? "bg-lime" : connectionState === "Problem" ? "bg-amber-300" : "bg-mist")} aria-hidden />{connectionState}
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">

              <StopButton visible={running || !!pendingApproval} />
              <button
                type="button"
                className="icon-button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                data-testid="settings-button"
              >
                <Settings2 className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="icon-button lg:hidden"
                onClick={() => setRailOpen(true)}
                aria-label="Open plan and activity"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="mx-auto flex min-h-0 w-full max-w-[840px] flex-1 flex-col px-5 pb-4 md:px-9">
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
            <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain py-6 [overflow-wrap:anywhere]" aria-label="Conversation">
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

              {signedIn && messages.length === 0 && !pendingApproval && !blockedNotice && !stopped && !running && !repairPlan && plan.length === 0 && activity.length === 0 && (
                <EmptyState
                  onPick={(s) => {
                    setText(s);
                    requestAnimationFrame(() => {
                      const el = inputRef.current;
                      el?.focus();
                      el?.setSelectionRange(s.length, s.length);
                    });
                  }}
                />
              )}

              {messages.map((m, index) => (
                <motion.div
                  key={m.id}
                  initial={historyIds.current?.has(m.id) ? false : { opacity: 0, y: 12, scale: m.role === "user" ? 0.97 : 1 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  style={{ transformOrigin: m.role === "user" ? "100% 100%" : "0% 0%" }}
                  className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-sm border border-line bg-surface px-5 py-3.5 text-base leading-relaxed text-ink"
                        : "group max-w-[95%] py-1 text-base leading-[1.8] text-ink/90"
                    }
                    data-testid={m.role === "assistant" ? "assistant-reply" : "user-message"}
                  >
                    {m.role === "assistant" && (
                      <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-lime-deep">
                        <span className="h-1 w-1 rounded-full bg-lime" aria-hidden /> Lalime
                      </p>
                    )}
                    {m.role === "assistant" ? (
                      <>
                        <RichText text={m.content} reveal={!historyIds.current?.has(m.id)} />
                        <div className="-ml-2 mt-1 flex flex-wrap items-start gap-x-1 gap-y-1">
                          <CopyButton text={m.content} />
                          <ReadAloudButton text={m.content} stopped={stopped} />
                          <button type="button" disabled={!canFollowUp} onClick={() => void send(`${t("reply.simplerPrompt")}\n\n${m.content}`)} className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs text-muted transition enabled:hover:bg-ink/5 enabled:hover:text-ink disabled:opacity-45">{t("reply.simpler")}</button>
                        </div>
                        {index === currentAnswerIndex && (repairPlan ? <RepairChecklist plan={repairPlan} /> : <StepTimeline plan={plan} />)}
                        {index === currentAnswerIndex && canFollowUp && !stopped && !blockedNotice && <FollowUps activity={activity[0]} onPick={pickFollowUp} />}
                      </>
                    ) : (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    )}
                  </div>
                </motion.div>
              ))}

              {currentAnswerIndex < 0 && (repairPlan ? <RepairChecklist plan={repairPlan} /> : <StepTimeline plan={plan} />)}
              <ChangeSummary />

              <AnimatePresence>
                {pendingApproval && <ApprovalCard pending={pendingApproval} pendingCount={pendingApprovalCount} queue={approvalQueue} />}
                {blockedNotice && <BlockedCard decision={blockedNotice} />}
              </AnimatePresence>

              {stopped && !running && !pendingApproval && <StoppedCard
                onContinue={() => { setText(t("stopped.prompt")); inputRef.current?.focus(); }}
                onStartOver={() => { setText(""); inputRef.current?.focus(); }}
              />}

            </div>
            <JumpToLatest visible={hasConversation && !pendingApproval && !atBottom} unseen={unseen} onClick={() => scrollToBottom()} />
            </div>

            <div className="mb-2.5">
              <WorkingIndicator running={running} waiting={!!pendingApproval} text={statusText === "Ready" && connectionState !== "Ready" ? connectionState : statusText} />
            </div>
            {sendError && <p role="alert" className="mb-2 text-sm text-danger">{t("reply.sendError")}</p>}

            <form
              onSubmit={(e) => void onSubmit(e)}
              className={`shadow-soft flex shrink-0 items-end gap-2 rounded-2xl border border-ink/20 bg-[#242424] p-2 transition-[border-color,box-shadow] duration-300 focus-within:border-lime/60 focus-within:shadow-[0_0_0_1px_#2bc50073,0_0_28px_-8px_#2bc50059] ${running && !pendingApproval ? "lalime-working-edge" : ""}`}
            >
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={1}
                placeholder={
                  signedIn ? "What do you need help with?" : "Sign in to ask Lalime for help…"
                }
                className="min-h-[52px] min-w-0 flex-1 resize-none bg-transparent px-3 py-3.5 text-base outline-none placeholder:text-muted focus-visible:outline-none"
                aria-label="Message Lalime"
                aria-describedby={canRecall ? "composer-recall-hint" : undefined}
                data-testid="chat-input"
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" && canRecall && !sendingRef.current && !e.repeat
                    && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
                    && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                    e.preventDefault();
                    setText(lastRequest);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onSubmit(e);
                  }
                }}
              />
              <button
                type="submit"
                disabled={!text.trim() || running || !!pendingApproval || sending}
                className="mb-1 mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-lime text-on-lime shadow-[0_4px_18px_-4px_#2bc50080] transition-[filter,transform,background-color,box-shadow] duration-200 enabled:hover:-translate-y-px enabled:hover:brightness-110 enabled:active:translate-y-0 enabled:active:scale-95 disabled:bg-ink/10 disabled:text-muted disabled:shadow-none"
                aria-label="Send"
                data-testid="chat-send"
              >
                <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </form>
            {canRecall && <p id="composer-recall-hint" className="mt-2 text-[11px] text-muted">{t("composer.recall")}</p>}
            <div className="mt-3 flex shrink-0 items-center justify-between gap-3 text-[11px] text-muted">
              <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-lime/80" aria-hidden />You approve the important steps.</span>
              <span className="hidden sm:inline">Enter to send <span className="mx-1 text-mist">/</span> Shift + Enter for a new line</span>
            </div>
          </div>
        </main>

        <div className="hidden w-[300px] shrink-0 flex-col border-l border-line bg-paper-2/80 lg:flex xl:w-[320px]">
          <PlanRail plan={plan} activity={activity} />
        </div>
      </div>

        {railOpen && (
          <Modal label="Plan and activity" drawer onClose={() => setRailOpen(false)}>
              <div className="flex shrink-0 items-center justify-end gap-3 px-5 pt-4">
                <StopButton visible={running || !!pendingApproval} />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setRailOpen(false)}
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <PlanRail plan={plan} activity={activity} />
          </Modal>
        )}

        {settingsOpen && (
          <Modal label="Settings" onClose={() => setSettingsOpen(false)} testId="settings-modal">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-display text-2xl font-bold tracking-tight text-ink">Settings</h2></div>
                <div className="ml-auto flex items-center gap-3">
                <StopButton visible={running || !!pendingApproval} />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                >
                  <X className="h-4 w-4" />
                </button>
                </div>
              </div>
              <ProviderSettings onPick={(prompt) => {
                setText(prompt); setSettingsOpen(false);
                requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(prompt.length, prompt.length); });
              }} />
                {settingsMsg && (
                  <p className="whitespace-pre-wrap text-sm text-ink/60" data-testid="settings-msg">
                    {settingsMsg}
                  </p>
                )}

              <div className="mt-8 border-t border-ink/10 pt-6" data-testid="settings-writer">
                <h3 className="font-display text-lg font-bold text-ink">
                  {t("settings.writerHeading")}
                </h3>
                <p className="mt-2 text-sm text-ink/55">{t("settings.writerBlurb")}</p>
                {writer.enabled && writer.model && (
                  <p className="mt-3 text-sm text-ink/60" data-testid="writer-model-hint">
                    Using {writer.providerId ? `${writer.providerId} / ` : ""}{writer.model} for clearer replies.
                  </p>
                )}
                {!writer.enabled && (
                  <p className="mt-3 text-sm text-ink/55" data-testid="writer-disabled-hint">
                    Connect a provider above to turn this on. ChatGPT sign-in alone keeps the regular reply text.
                  </p>
                )}
                {writer.lastError && (
                  <p className="mt-2 text-sm text-ink/55" data-testid="writer-last-error">
                    {writer.lastError}
                  </p>
                )}
              </div>
              <AboutPanel />
          </Modal>
        )}
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
    <div className="flex min-h-full flex-col justify-center py-10" data-testid="sign-in-gate">
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
          Choose a provider
        </PrimaryButton>
      </div>
      <p className="mt-6 max-w-md text-sm text-ink/45">
        {t("signin.setup")}
      </p>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex min-h-full flex-col justify-center py-3" data-testid="empty-state">
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-display max-w-[600px] text-[2rem] font-bold leading-[1.12] tracking-[-0.05em] text-ink sm:text-[2.65rem] xl:text-[2.85rem]"
      >
        {t("empty.title")}
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="mt-4 max-w-[500px] text-base leading-relaxed text-muted"
      >
        {t("empty.body")}
      </motion.p>
        <section aria-label={t("empty.reassuranceTitle")} className="mt-5 flex max-w-[560px] gap-3 rounded-xl border border-lime/15 bg-lime/5 p-3.5 text-sm leading-relaxed text-ink-soft">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden />
          <div><p>{t("empty.reassurance")}</p><p className="mt-2 text-muted">{t("empty.draftHint")}</p></div>
        </section>
      <p className="eyebrow mb-3 mt-7">Try a task</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map(({ prompt, title, icon: Icon }, i) => (
          <motion.button
            key={prompt}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.04 }}
            onClick={() => onPick(prompt)}
            className="group rounded-xl border border-line bg-surface/60 p-4 text-left transition hover:border-lime/35 hover:bg-surface"
            data-testid="suggestion-chip"
          >
            <span className="mb-3 flex items-center justify-between"><Icon className="h-5 w-5 text-lime-deep" strokeWidth={1.5} aria-hidden /><ArrowUpRight className="h-3.5 w-3.5 text-mist transition group-hover:text-lime" aria-hidden /></span>
            <span className="block text-sm font-semibold text-ink">{title}</span>
            <span className="mt-1.5 block text-sm leading-relaxed text-muted">{prompt}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
