import { useCallback, useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { t } from "../../copy";

const READING_EVENT = "lalime-read-aloud";

export function stopReadAloud() {
  window.dispatchEvent(new Event(READING_EVENT));
}

export function ReadAloudButton({ text, stopped }: { text: string; stopped: boolean }) {
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopReading = useCallback(() => {
    if (utterance.current) {
      utterance.current.onend = null;
      utterance.current.onerror = null;
      utterance.current = null;
      window.speechSynthesis?.cancel();
    }
    setReading(false);
  }, []);

  useEffect(() => {
    window.addEventListener(READING_EVENT, stopReading);
    return () => { window.removeEventListener(READING_EVENT, stopReading); stopReading(); };
  }, [stopReading]);
  useEffect(() => { if (stopped) stopReading(); }, [stopped, stopReading]);

  function read() {
    if (reading) { stopReading(); return; }
    setError(null);
    const synthesis = window.speechSynthesis;
    if (!synthesis || typeof SpeechSynthesisUtterance === "undefined") {
      setError(t("reply.speechUnavailable"));
      return;
    }
    try {
      // Never send answer text to an online system voice.
      const localVoices = synthesis.getVoices().filter((voice) => voice.localService);
      const voice = localVoices.find((candidate) => candidate.lang === navigator.language) ?? localVoices[0];
      if (!voice) { setError(t("reply.speechUnavailable")); return; }
      stopReadAloud();
      synthesis.cancel();
      const next = new SpeechSynthesisUtterance(text);
      next.voice = voice;
      next.lang = voice.lang;
      next.onend = () => { if (utterance.current === next) { utterance.current = null; setReading(false); } };
      next.onerror = (event) => {
        if (utterance.current !== next) return;
        utterance.current = null;
        setReading(false);
        if (event.error !== "canceled" && event.error !== "interrupted") setError(t("reply.speechError"));
      };
      utterance.current = next;
      setReading(true);
      synthesis.speak(next);
    } catch {
      stopReading();
      setError(t("reply.speechError"));
    }
  }

  return (
    <div>
      <button type="button" onClick={read} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-muted transition hover:bg-ink/5 hover:text-ink" aria-pressed={reading}>
        {reading ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
        {t(reading ? "reply.stopReading" : "reply.read")}
      </button>
      {error && <p role="status" className="max-w-60 px-2 text-xs text-amber-300">{error}</p>}
    </div>
  );
}
