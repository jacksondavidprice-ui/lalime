import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  // Relative asset URLs so Electron loadFile(file://) works after npm run build.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@guardian": path.resolve(__dirname, "guardian/src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  server: {
    port: 43123,
    strictPort: true,
    host: "127.0.0.1",
  },
  preview: {
    port: 43123,
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
