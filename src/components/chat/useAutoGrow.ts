import { useLayoutEffect, useRef } from "react";

/** Grows a textarea with its content up to `maxPx`, then scrolls inside it. */
export function useAutoGrow(value: string, maxPx = 220) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      el.style.height = "auto";
      const next = Math.min(el.scrollHeight, maxPx);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
    };
    measure();
    let width = el.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = el.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        measure();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, maxPx]);
  return ref;
}
