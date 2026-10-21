/**
 * Decide how Electron loads the UI.
 *
 * Standalone after `npm run build` must use dist/index.html (file://).
 * Dev server is opt-in via LALIME_DEV=1 (set by `npm run dev`).
 */

export type RendererLoadTarget =
  | { type: "url"; url: string }
  | { type: "file"; path: string };

export function resolveRendererLoad(input: {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  distIndexHtml: string;
}): RendererLoadTarget {
  const flag = (input.env.LALIME_DEV ?? "").trim().toLowerCase();
  const useDevServer = flag === "1" || flag === "true" || flag === "yes";

  if (useDevServer) {
    const url = (input.env.LALIME_DEV_URL ?? "http://127.0.0.1:43123").trim();
    return { type: "url", url };
  }

  return { type: "file", path: input.distIndexHtml };
}
