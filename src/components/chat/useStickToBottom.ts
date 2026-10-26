import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps a scroll container pinned to the bottom while new content arrives,
 * but lets the reader scroll up without being yanked back down.
 */
export function useStickToBottom<T extends HTMLElement>(enabled = true, threshold = 80) {
  const ref = useRef<T>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const previousTop = useRef(0);
  const [unseen, setUnseen] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    // Content growth changes the gap without moving the reader. Only an upward
    // move away from the end disables following.
    if (near) atBottomRef.current = true;
    else if (el.scrollTop < previousTop.current) atBottomRef.current = false;
    previousTop.current = el.scrollTop;
    setAtBottom(near);
    if (near) setUnseen(false);
  }, [threshold]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    previousTop.current = el.scrollTop;
    atBottomRef.current = true;
    setAtBottom(true);
    setUnseen(false);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });

    // Content growth (new messages, cards expanding, word reveal) — follow it if pinned.
    const onGrow = () => {
      // Nothing to follow yet (e.g. the welcome screen): leave it at the top.
      if (!enabledRef.current) return;
      if (atBottomRef.current) {
        // Move directly so intermediate scroll events cannot disable following.
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      } else {
        setUnseen(true);
      }
    };
    const ro = new ResizeObserver(onGrow);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver(() => {
      ro.disconnect();
      ro.observe(el);
      for (const child of Array.from(el.children)) ro.observe(child);
      onGrow();
    });
    mo.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  return { ref, atBottom, unseen, scrollToBottom };
}
