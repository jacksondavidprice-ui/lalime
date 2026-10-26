import { motion, useReducedMotion } from "framer-motion";
import logoMark from "../assets/logo-mark.png";
import { t } from "../copy";

/** This animation never controls when the app becomes ready. */
export function BootSplash() {
  const reducedMotion = useReducedMotion();

  return (
    <div className="bg-atmosphere relative flex h-full min-h-0 items-center justify-center overflow-hidden">
      <div className="bg-grain absolute inset-0" aria-hidden />
      <div className="relative flex flex-col items-center gap-6 px-6 text-center" role="status" aria-live="polite">
        <div className="relative grid grid-cols-4" style={{ width: 96, height: 96 }} aria-hidden>
          {Array.from({ length: 16 }, (_, index) => {
            const column = index % 4;
            const row = Math.floor(index / 4);
            return (
              <motion.span
                key={index}
                data-testid="boot-logo-cell"
                aria-hidden="true"
                initial={reducedMotion ? false : { opacity: 0, x: (column - 1.5) * 12, y: (row - 1.5) * 12, scale: 0.7 }}
                animate={reducedMotion ? { opacity: 1 } : { opacity: 1, x: 0, y: 0, scale: 1 }}
                transition={{ duration: reducedMotion ? 0 : 0.35, delay: reducedMotion ? 0 : (column + row) * 0.045, ease: "easeOut" }}
                style={{
                  width: 24,
                  height: 24,
                  backgroundImage: `url(${logoMark})`,
                  backgroundSize: "96px 96px",
                  backgroundPosition: `${-column * 24}px ${-row * 24}px`,
                  backgroundRepeat: "no-repeat",
                }}
              />
            );
          })}
        </div>
        <div>
          <p className="font-display text-4xl font-extrabold tracking-tight text-ink">Lalime</p>
          <p className="eyebrow mt-3">{t("boot.status")}</p>
        </div>
      </div>
    </div>
  );
}
