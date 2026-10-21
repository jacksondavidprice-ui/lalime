import { spawn } from "node:child_process";
import net from "node:net";

function waitForPort(port, host = "127.0.0.1", timeoutMs = 90000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ port, host }, () => {
        sock.end();
        resolve(undefined);
      });
      sock.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

const vite = spawn(
  "npx",
  ["vite", "--port", "43123", "--strictPort", "--host", "127.0.0.1"],
  { stdio: "inherit", shell: true },
);

try {
  await waitForPort(43123);
} catch (err) {
  vite.kill();
  console.error(err);
  process.exit(1);
}

const electron = spawn("npx", ["electron", "."], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    LALIME_DEV: "1",
    LALIME_DEV_URL: process.env.LALIME_DEV_URL ?? "http://127.0.0.1:43123",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
});

function shutdown() {
  vite.kill();
  electron.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

electron.on("exit", () => {
  vite.kill();
  process.exit(0);
});
