/**
 * Scripted / mock replies are for CI and local fixtures only.
 * A packaged Electron build can never enable them — even if env is set.
 */

export type DevFlagEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function isPackagedBuild(
  isPackaged: boolean,
  env: DevFlagEnv = process.env,
): boolean {
  if (isPackaged) return true;
  const flag = (env.LALIME_PACKAGED ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function isScriptedMockAllowed(input: {
  isPackaged: boolean;
  env?: DevFlagEnv;
}): boolean {
  const env = input.env ?? process.env;
  if (isPackagedBuild(input.isPackaged, env)) return false;
  const demo = (env.LALIME_DEMO ?? "").trim().toLowerCase();
  if (demo === "1" || demo === "true" || demo === "yes") return true;
  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "test") return true;
  if ((env.VITEST ?? "").trim() === "true") return true;
  return false;
}
