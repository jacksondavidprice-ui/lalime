import { Square } from "lucide-react";
import { getApi } from "../lib/bridge";

export function StopButton({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => void getApi().stop()}
      className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-soft transition hover:bg-ink-soft"
      data-testid="stop-button"
      title="Stop Lalime (Ctrl+Alt+Esc in the desktop app)"
    >
      <Square className="h-3.5 w-3.5 fill-current" />
      Stop
    </button>
  );
}
