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
        "primary-button inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-5 py-3 font-semibold transition-[background-color,border-color,box-shadow,filter,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime focus-visible:ring-offset-2 focus-visible:ring-offset-paper enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        tone === "lime" && "border-transparent bg-lime text-[#101310] shadow-[0_3px_14px_rgba(43,197,5,0.12)] enabled:hover:brightness-110",
        tone === "ink" && "border-transparent bg-ink text-paper enabled:hover:brightness-90",
        tone === "ghost" && "border-ink/10 bg-transparent text-ink/80 enabled:hover:border-ink/20 enabled:hover:bg-ink/5 enabled:hover:text-ink",
        tone === "danger" && "border-transparent bg-danger text-paper enabled:hover:brightness-110",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
