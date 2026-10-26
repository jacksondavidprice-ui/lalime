import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { t } from "../../copy";
import "./chat-motion.css";

/**
 * The line above the composer. While Lalime works it shows three breathing dots and a
 * shimmering status that crossfades as the step changes; when idle it's a quiet caption.
 */
export function WorkingIndicator({
  running,
  waiting,
  text,
}: {
  running: boolean;
  /** Waiting on the user (approval card open): no shimmer, the card is the focus. */
  waiting?: boolean;
  text: string;
}) {
  const active = running && !waiting;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!active) return;
    const start = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return (
    <div
      className="flex min-h-6 shrink-0 flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-center text-xs"
      data-testid="status-text"
    >
      <AnimatePresence initial={false}>
        {active && (
          <motion.span
            key="dots"
            className="flex items-center gap-1"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            aria-hidden
          >
            <span className="lalime-dot" />
            <span className="lalime-dot" />
            <span className="lalime-dot" />
          </motion.span>
        )}
      </AnimatePresence>
      <span role="status" aria-live="polite">
      {active ? <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
          className={active ? "lalime-shimmer font-medium" : waiting ? "font-medium text-lime-deep" : "text-muted"}
        >
          {text}
        </motion.span>
      </AnimatePresence> : <span className={waiting ? "font-medium text-lime-deep" : "text-muted"}>{text}</span>}
      </span>
      {active && elapsed >= 10 && <span className="text-muted" data-testid="working-elapsed">{t("working.elapsed")} · {elapsed} {t("working.seconds")}</span>}
    </div>
  );
}
