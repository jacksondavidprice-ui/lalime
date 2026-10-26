import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { getApi } from "../../lib/bridge";

/** Small hover action under an assistant reply. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        setCopied(false);
        setFailed(false);
        void (async () => {
          try {
            await getApi().copyText(text);
            setCopied(true);
          } catch {
            setFailed(true);
          }
        })();
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink"
      aria-label={copied ? "Copied" : failed ? "Copy failed, try again" : "Copy reply"}
      data-testid="copy-reply"
    >
      <span className="relative grid h-3.5 w-3.5 place-items-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={copied ? "check" : "copy"}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.14 }}
            className="absolute inset-0 grid place-items-center"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-lime" /> : <Copy className="h-3.5 w-3.5" />}
          </motion.span>
        </AnimatePresence>
      </span>
      <span aria-live="polite">{copied ? "Copied" : failed ? "Copy failed, try again" : "Copy"}</span>
    </button>
  );
}
