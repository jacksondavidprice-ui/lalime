import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/settings";
import { PROVIDERS } from "@shared/providers";
import { getApi } from "../lib/bridge";
import { useAppStore } from "../lib/store";
import { PrimaryButton } from "./PrimaryButton";
import { ConnectionPanel } from "./ConnectionPanel";
import { t } from "../copy";
import { connectionFromSnapshot } from "../lib/connection";

export function ProviderSettings({ onPick = () => {} }: { onPick?: (prompt: string) => void }) {
  const saved = useAppStore((s) => s.settings);
  const running = useAppStore((s) => s.running);
  const auth = useAppStore((s) => s.auth);
  const connection = useAppStore(connectionFromSnapshot);
  const [draft, setDraft] = useState<Omit<AppSettings, "maxToolCalls" | "requestTimeoutMs">>(() => {
    const value = { ...DEFAULT_SETTINGS, ...saved };
    return { providerId: value.providerId, model: value.model, baseUrl: value.baseUrl, instructions: value.instructions,
      maxTokens: value.maxTokens, temperature: value.temperature,
      allowScreenCapture: value.allowScreenCapture, allowComputerControl: value.allowComputerControl };
  });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string>();
  useEffect(() => { setChecking(false); setFailure(undefined); }, [connection]);
  const request = useRef<symbol | null>(null);
  useEffect(() => () => { request.current = null; }, []);
  const provider = PROVIDERS.find((entry) => entry.id === draft.providerId);
  const chatgpt = draft.providerId === "chatgpt";
  const editableEndpoint = draft.providerId === "custom" || draft.providerId === "ollama";
  const disabled = running || busy;
  function update<K extends keyof typeof draft>(name: K, value: (typeof draft)[K]) {
    setDraft((previous) => ({ ...previous, [name]: value }));
  }
  function beginRequest() {
    const id = Symbol();
    request.current = id;
    const initialConnection = connectionFromSnapshot(useAppStore.getState());
    return {
      active: () => request.current === id,
      mayReport: () => {
        const latest = connectionFromSnapshot(useAppStore.getState());
        return request.current === id && !(latest !== initialConnection && latest && latest.state !== "checking");
      },
    };
  }
  async function save(connect: boolean) {
    const pending = beginRequest();
    setBusy(true); setMessage(""); setFailure(undefined); setChecking(connect);
    try {
      const result = await getApi().updateSettings(draft);
      if (!pending.active()) return;
      if (!result.ok) {
        if (pending.mayReport()) { setFailure(result.message ?? "Could not save settings. Try again."); setChecking(false); }
        return;
      }
      if (connect) {
        const response = await getApi().connectProvider(key || undefined);
        if (!pending.active()) return;
        if (!response.ok && pending.mayReport()) { setFailure(response.message ?? "Could not connect. Check your sign-in details and try again."); setChecking(false); }
        else if (!connectionFromSnapshot(useAppStore.getState())) setChecking(false);
        setKey("");
      } else setMessage("Settings saved. Connect to start a new conversation.");
    } catch {
      if (pending.mayReport()) { setFailure("Could not complete this request. Please try again in the desktop app."); setChecking(false); }
    } finally { if (pending.active()) setBusy(false); }
  }

  async function retry() {
    const api = getApi() as ReturnType<typeof getApi> & { retryConnectionCheck?: () => Promise<{ ok: boolean; message?: string }> };
    if (!api.retryConnectionCheck) { setFailure(t("connection.unavailable")); setChecking(false); return; }
    const pending = beginRequest();
    setBusy(true); setChecking(true); setFailure(undefined);
    try {
      const result = await api.retryConnectionCheck();
      if (!result.ok && pending.mayReport()) { setFailure(result.message || t("connection.failureFallback")); setChecking(false); }
    }
    catch { if (pending.mayReport()) { setFailure("Could not check the connection. Please try again."); setChecking(false); } }
    finally { if (pending.active()) setBusy(false); }
  }

  return (
    <section className="mt-5 space-y-5 text-sm" aria-label="Provider and agent settings" data-testid="provider-settings">
      <label className="block space-y-2">
        <span className="font-semibold text-ink">AI provider</span>
        <select className="field w-full" value={draft.providerId} disabled={disabled} data-testid="provider-select"
          onChange={(event) => { update("providerId", event.target.value); update("baseUrl", ""); update("model", ""); setKey(""); }}>
          <option value="chatgpt">ChatGPT subscription through Codex</option>
          {PROVIDERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.id === "custom" ? " · compatible endpoint" : entry.requiresKey ? " · API key" : " · local"}</option>)}
        </select>
      </label>
      <p className="leading-relaxed text-muted">
        {chatgpt
          ? "Sign in with your own ChatGPT account in your browser. Your plan limits apply. Lalime keeps a separate Codex sign-in on this computer."
          : provider?.requiresKey || draft.providerId === "custom"
            ? "Use your own provider API key. API usage may be billed separately from a chat subscription. Lalime does not supply credits."
            : "Run a compatible model server on this computer. Local use needs no hosted AI subscription."}
      </p>
      {provider && <a className="text-lime underline underline-offset-4" href={provider.docsUrl} target="_blank" rel="noreferrer">Provider setup documentation</a>}
      <label className="block space-y-2">
        <span className="font-semibold text-ink">Model ID{chatgpt ? " (optional)" : " (required)"}</span>
        <input className="field w-full" value={draft.model} maxLength={200} disabled={disabled} data-testid="provider-model"
          placeholder={chatgpt ? "Use the Codex default" : "Enter a model available to your account"} onChange={(event) => update("model", event.target.value)} />
      </label>
      {editableEndpoint && <label className="block space-y-2">
        <span className="font-semibold text-ink">API base URL</span>
        <input className="field w-full" value={draft.baseUrl} disabled={disabled} placeholder={provider?.baseUrl || "https://your-provider.example/v1"} onChange={(event) => update("baseUrl", event.target.value)} />
        <span className="block text-xs text-muted">This endpoint receives your messages, tools, and any permitted screenshots. HTTPS is required except on loopback. Credentials must not be in the URL.</span>
      </label>}
      {!chatgpt && (provider?.requiresKey || draft.providerId === "custom") && <label className="block space-y-2">
        <span className="font-semibold text-ink">API key{draft.providerId === "custom" ? " (if required)" : ""}</span>
        <input className="field w-full" type="password" autoComplete="off" spellCheck={false} value={key} maxLength={4096} disabled={disabled}
          data-testid="settings-api-key" onChange={(event) => setKey(event.target.value)} />
        <span className="block text-xs text-muted">Kept in memory for this session. Never stored in settings or exported to the chat.</span>
      </label>}
      <fieldset className="space-y-3 rounded-xl border border-ink/10 p-4" disabled={disabled}>
        <legend className="px-1 font-semibold">Computer permissions</legend>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 accent-lime" checked={draft.allowScreenCapture} onChange={(event) => update("allowScreenCapture", event.target.checked)} /><span>Allow screen and window information to be sent to this provider</span></label>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 accent-lime" checked={draft.allowComputerControl} onChange={(event) => update("allowComputerControl", event.target.checked)} /><span>Allow computer actions after I approve each change</span></label>
        <p className="text-xs leading-relaxed text-muted">Both permissions are off by default. Guardian checks remain active when control is enabled.</p>
      </fieldset>
      <details className="rounded-xl border border-ink/10 p-4">
        <summary className="cursor-pointer font-semibold">Model options</summary>
        <div className="mt-4 space-y-4">
          <label className="block space-y-2"><span>Your instructions</span><textarea className="field min-h-24 w-full" maxLength={8000} value={draft.instructions} disabled={disabled} onChange={(event) => update("instructions", event.target.value)} placeholder="Preferred language, explanation style, or workflow" /></label>
          {!chatgpt && <>
            <label className="block space-y-2"><span>Maximum output tokens (256–32768)</span><input className="field w-full" type="number" min={256} max={32768} value={draft.maxTokens} disabled={disabled} onChange={(event) => update("maxTokens", Number(event.target.value))} /></label>
            <label className="block space-y-2"><span>Temperature (0–1; blank uses provider default)</span><input className="field w-full" type="number" min={0} max={1} step={0.1} value={draft.temperature ?? ""} disabled={disabled} onChange={(event) => update("temperature", event.target.value === "" ? null : Number(event.target.value))} /></label>
            <p className="text-xs text-muted">Model capabilities and token limits vary. Some reasoning models do not support temperature.</p>
          </>}
        </div>
      </details>
      <p className="text-xs leading-relaxed text-muted">Saving settings starts a new conversation and clears this view. Stop the current task before making changes.</p>
      <div className="flex flex-wrap gap-2">
        <PrimaryButton disabled={disabled || (!chatgpt && !draft.model.trim())} onClick={() => void save(true)} data-testid="provider-connect">{busy ? "Working…" : chatgpt ? "Save and sign in" : "Save and connect"}</PrimaryButton>
        <PrimaryButton tone="ghost" disabled={disabled} onClick={() => void save(false)}>Save settings</PrimaryButton>
        {auth.state === "signed_in" || auth.state === "signing_in" ? <PrimaryButton tone="ghost" disabled={busy} onClick={() => {
          setBusy(true);
          void getApi().disconnect().then(() => { setKey(""); setMessage("Disconnected."); }).catch(() => setMessage("Could not disconnect. Try again.")).finally(() => setBusy(false));
        }}>Disconnect</PrimaryButton> : null}
      </div>
      {message && <p className="whitespace-pre-wrap text-muted" role="status" data-testid="provider-message">{message}</p>}
      <ConnectionPanel connection={connection} signedIn={auth.state === "signed_in" || auth.state === "demo"} checking={checking} failure={failure}
        busy={disabled} onRetry={() => void retry()} onPick={onPick} />
    </section>
  );
}
