import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";

export function PrimaryButton({
  children,
  className,
  tone = "lime",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  tone?: "lime" | "ink" | "ghost" | "danger";
}) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-base font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        tone === "lime" && "bg-lime text-ink hover:brightness-95",
        tone === "ink" && "bg-ink text-paper hover:bg-ink-soft",
        tone === "ghost" && "bg-transparent text-ink hover:bg-black/5",
        tone === "danger" && "bg-danger text-white hover:brightness-95",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
