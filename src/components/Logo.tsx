import { motion } from "framer-motion";
import logoMark from "../assets/logo-mark.png";

const PX = {
  sm: 28,
  md: 40,
  lg: 56,
  hero: 88,
} as const;

export function Logo({
  size = "md",
  showWordmark = true,
}: {
  size?: keyof typeof PX;
  showWordmark?: boolean;
}) {
  const px = PX[size];
  const scale =
    size === "hero"
      ? "text-5xl md:text-6xl"
      : size === "lg"
        ? "text-4xl"
        : size === "sm"
          ? "text-xl"
          : "text-2xl";

  return (
    <div className="inline-flex items-center gap-3">
      <motion.img
        src={logoMark}
        alt=""
        width={px}
        height={px}
        draggable={false}
        className="select-none rounded-[22%] shadow-[0_8px_24px_rgba(11,13,12,0.18)]"
        style={{ width: px, height: px }}
        animate={{ scale: [1, 1.03, 1] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      />
      {showWordmark && (
        <span className={`font-display font-extrabold tracking-tight text-ink ${scale}`}>
          Lalime
        </span>
      )}
    </div>
  );
}
