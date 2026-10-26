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
        ? "text-3xl"
        : size === "sm"
          ? "text-xl"
          : "text-2xl";

  return (
    <div className="inline-flex shrink-0 items-center gap-3">
      <img
        src={logoMark}
        alt=""
        width={px}
        height={px}
        draggable={false}
        className="select-none rounded-[22%] shadow-[0_6px_20px_rgba(0,0,0,0.18)]"
        style={{ width: px, height: px }}
      />
      {showWordmark && (
        <span className={`font-display font-extrabold tracking-tight text-ink ${scale}`}>
          Lalime
        </span>
      )}
    </div>
  );
}
