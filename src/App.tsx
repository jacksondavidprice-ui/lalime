import { useEffect } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useAppStore } from "./lib/store";
import { Onboarding } from "./pages/Onboarding";
import { ChatHome } from "./pages/ChatHome";
import { BootSplash } from "./components/BootSplash";

export function App() {
  const hydrate = useAppStore((s) => s.hydrate);
  const ready = useAppStore((s) => s.ready);
  const onboardingComplete = useAppStore((s) => s.onboardingComplete);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!ready) {
    return (
      <MotionConfig reducedMotion="user">
        <BootSplash />
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
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
    </MotionConfig>
  );
}
