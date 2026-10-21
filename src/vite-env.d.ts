/// <reference types="vite/client" />

import type { LalimeApi } from "@shared/ipc";

declare global {
  interface Window {
    lalime?: LalimeApi;
  }
}

export {};
