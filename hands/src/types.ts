/** Cross-platform Hands contract (mock, Node, or Windows Hands.exe). */

export interface HandsResult {
  ok: boolean;
  output: string;
  journalId?: string;
  undoToken?: string;
  /** Count of confirmed file moves, including moves from a partial batch. */
  completedItems?: number;
  /** Cumulative restored journal items; a directory counts as one complete item. */
  restoreProgress?: { restored: number; total: number };
  /** Optional screenshot as data URL for dynamic tool image results. */
  imageDataUrl?: string;
}

export interface WindowElement {
  name: string;
  controlType?: string;
  automationId?: string;
}

export interface HandsClient {
  readonly backend: "mock" | "node" | "windows";
  /** False when Windows Hands.exe is missing from disk. Mock/Node are always available. */
  isAvailable(): boolean;
  /** Resolved Hands.exe path when backend is windows (may be missing). */
  exePath?(): string | undefined;
  stop(): void;
  resume(): void;
  listJournal(): Array<{ id: string; summary: string; undone: boolean }>;
  runPowerShell(command: string, summary: string): Promise<HandsResult>;
  /** Pattern-based command precheck. This is not a complete PowerShell AST sandbox. */
  precheckPowerShell(command: string): Promise<{ blocked: boolean; reason?: string }>;
  moveToRecycleBin(paths: string[], summary: string): Promise<HandsResult>;
  openSettings(uri: string): Promise<HandsResult>;
  screenshot(): Promise<HandsResult>;
  listWindows(): Promise<{ ok: boolean; windows: Array<{ title: string; pid?: number }> }>;
  listUiElements(windowTitle?: string): Promise<{ ok: boolean; elements: WindowElement[] }>;
  clickElement(name: string, windowTitle?: string): Promise<HandsResult>;
  typeText(text: string, windowTitle?: string): Promise<HandsResult>;
  undo(journalId: string): Promise<HandsResult>;
}
