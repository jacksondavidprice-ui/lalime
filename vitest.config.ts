import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Keep calls made during beforeAll for the application lifecycle tests.
    clearMocks: false,
    environment: "node",
    include: [
      "guardian/tests/**/*.test.ts",
      "shared/**/*.test.ts",
      "hands/**/*.test.ts",
      "tests/**/*.test.ts",
      "electron/**/*.test.ts",
      "writer/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@guardian": path.resolve(__dirname, "guardian/src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
