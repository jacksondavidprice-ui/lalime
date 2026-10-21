import { CodexAppServerClient } from "../electron/main/codex-client.ts";
import { FakeCodexServer } from "../electron/main/fake-codex-server.ts";

async function main() {
  const fake = new FakeCodexServer();
  const client = new CodexAppServerClient({ transport: fake.transport() });
  client.on("parse_error", (l) => console.log("parse_error", l));
  console.log("starting...");
  const t = setTimeout(() => {
    console.log("TIMEOUT on start");
    process.exit(1);
  }, 2000);
  await client.start();
  clearTimeout(t);
  console.log("started OK");
  await client.loginWithApiKey("sk-test");
  console.log("login OK");
  const tid = await client.startThread({ dynamicTools: [] });
  console.log("thread", tid);
  process.exit(0);
}

void main();
