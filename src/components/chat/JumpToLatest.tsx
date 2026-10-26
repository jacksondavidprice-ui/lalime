import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown } from "lucide-react";

export function JumpToLatest({
  visible,
  unseen,
  onClick,
}: {
  visible: boolean;
  unseen: boolean;
  onClick: () => void;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={onClick}
          initial={{ opacity: 0, y: 12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 500, damping: 34 }}
          whileTap={{ scale: 0.96 }}
          className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface/90 px-3.5 py-2 text-xs font-semibold text-ink shadow-[0_10px_30px_#0007] backdrop-blur transition-colors hover:border-lime/40 hover:bg-surface"
          data-testid="jump-to-latest"
        >
          {unseen && <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />}
          {unseen ? "New reply" : "Jump to latest"}
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
