import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAppStore } from "./lib/store";
import { Onboarding } from "./pages/Onboarding";
import { ChatHome } from "./pages/ChatHome";

export function App() {
  const hydrate = useAppStore((s) => s.hydrate);
  const ready = useAppStore((s) => s.ready);
  const onboardingComplete = useAppStore((s) => s.onboardingComplete);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!ready) {
    return (
      <div className="bg-atmosphere relative flex h-full items-center justify-center">
        <div className="bg-grain absolute inset-0" />
        <p className="font-display text-2xl font-bold tracking-tight text-ink">Lalime</p>
      </div>
    );
  }

  return (
    <div className="bg-atmosphere relative h-full overflow-hidden">
      <div className="bg-grain absolute inset-0" />
      <AnimatePresence mode="wait">
        {!onboardingComplete ? (
          <motion.div
            key="onboarding"
            className="relative h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            <Onboarding />
          </motion.div>
        ) : (
          <motion.div
            key="chat"
            className="relative h-full"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <ChatHome />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
