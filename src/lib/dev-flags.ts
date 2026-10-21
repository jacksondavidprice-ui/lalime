/**
 * Browser-only scripted DemoEngine is allowed only in Vite DEV with an explicit flag.
 * Production renderer builds never enable it.
 */

export function isBrowserScriptedMockAllowed(
  search = typeof window !== "undefined" ? window.location.search : "",
): boolean {
  if (import.meta.env.PROD) return false;
  const viteFlag = String(import.meta.env.VITE_LALIME_DEMO ?? "")
    .trim()
    .toLowerCase();
  if (viteFlag === "1" || viteFlag === "true" || viteFlag === "yes") return true;
  const params = new URLSearchParams(search);
  const q = (params.get("demo") ?? "").trim().toLowerCase();
  return q === "1" || q === "true" || q === "yes";
}
