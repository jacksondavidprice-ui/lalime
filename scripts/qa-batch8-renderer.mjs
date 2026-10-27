// Render real compiled-host snapshots through a preload VM and a browser fixture.
// This does not use SessionController or actual Electron IPC. No command executes.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { chromium } from 'playwright';

const appRoot = path.resolve(process.argv.find(arg => arg.startsWith('--app-root='))?.slice('--app-root='.length) || 'artifacts/codex-c-batch8');
const build = path.join(appRoot, 'dist-electron');
const evidence = path.resolve(process.argv.find(arg => arg.startsWith('--evidence-dir='))?.slice('--evidence-dir='.length) || 'scratch/qa-batch8');
const { LiveAgentHost } = await import(pathToFileURL(path.join(build, 'electron/main/live-agent.js')));
const { MockHands } = await import(pathToFileURL(path.join(build, 'hands/mock/index.js')));
class Client extends EventEmitter {
  startThread = async () => 'fixture';
  startTurn = async () => ({ turnId: 'fixture-turn' });
  interruptTurn = async () => {};
  respondApproval() {}
  respondFileChangeApproval() {}
  respondToolCall() {}
}
async function snapshotFor(commands) {
  const client = new Client();
  const host = new LiveAgentHost(client, new MockHands(), { allowComputerControl: true });
  const state = { mode: 'live', auth: { state: 'signed_in', method: 'local' }, onboardingComplete: true,
    messages: [], plan: [], activity: [], pendingApproval: null, pendingApprovalCount: 0, approvalQueue: [],
    blockedNotice: null, running: true, stopped: false, statusText: 'Waiting for your OK',
    hands: { backend: 'mock', available: true }, writer: { enabled: false, providerId: null, model: null } };
  host.on('approvalNeeded', card => { state.pendingApproval = card; });
  host.on('approvalQueue', (count, entries) => { state.pendingApprovalCount = count; state.approvalQueue = entries; });
  try {
    await host.runTurn('Review the fixture requests');
    for (const [index, command] of commands.entries()) {
      client.emit('serverRequest', { id: index + 1, method: 'item/commandExecution/requestApproval',
        params: { itemId: `fixture-${index}`, command } });
      await new Promise(resolve => setImmediate(resolve));
    }
    let api;
    vm.runInNewContext(readFileSync(path.join(build, 'electron/preload/index.cjs'), 'utf8'), {
      require(name) {
        assert.equal(name, 'electron');
        return { contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
          ipcRenderer: { invoke: async channel => { assert.equal(channel, 'lalime:getSnapshot'); return state; } } };
      },
    }, { timeout: 1000 });
    return structuredClone(await api.getSnapshot());
  } finally { await host.stop(); }
}
const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL || 'msedge' });
const checks = [];
try {
  for (const [name, commands] of [
    ['large queue', Array.from({ length: 300 }, (_, index) => `Write-Output '${'x'.repeat(50000)}-${index}'`)],
    ['Invoke-Item executable', ["Invoke-Item 'C:\\Users\\Fixture\\Downloads\\tool.exe'"]],
    ['UNC Start-Process', ["Start-Process '\\\\server\\share\\report.pdf'"]],
  ]) {
    const snapshot = await snapshotFor(commands);
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    page.setDefaultTimeout(5000);
    try {
      await page.addInitScript(state => {
        window.lalime = { getSnapshot: async () => state, subscribe: () => () => {},
          writerStatus: async () => state.writer,
          respondApproval: async () => { throw new Error('Read-only fixture cannot consent'); } };
      }, snapshot);
      await page.goto(process.env.LALIME_URL || 'http://127.0.0.1:43128', { waitUntil: 'networkidle' });
      await page.getByTestId('approval-card').waitFor();
      if (name === 'large queue') {
        assert.equal(snapshot.pendingApprovalCount, 300);
        assert.equal(snapshot.approvalQueue.length, 50);
        await page.getByRole('button', { name: '299 more waiting', exact: true }).click();
        const list = page.getByRole('list', { name: 'Approval queue', exact: true });
        assert.equal(await list.getByRole('listitem').count(), 20);
        assert.equal(await list.getByRole('button').count(), 0);
        assert.deepEqual(await list.getByTestId('approval-queue-summary').allTextContents(), snapshot.approvalQueue.slice(0, 20).map(entry => entry.summary));
        await page.getByText('and 280 more waiting', { exact: true }).waitFor();
      } else {
        assert.equal(snapshot.pendingApproval.canAllowForTask, false);
        assert.equal(await page.getByRole('button', { name: 'Allow for this task', exact: true }).count(), 0);
        const reason = snapshot.pendingApproval.grantUnavailableReason;
        assert.ok(reason);
        assert.ok((await page.getByTestId('grant-unavailable').textContent()).includes(reason));
      }
      checks.push(name);
      console.log(`PASS compiled host/preload snapshot rendered: ${name}`);
    } finally { await page.close(); }
  }
} finally {
  await browser.close();
  mkdirSync(evidence, { recursive: true });
  writeFileSync(path.join(evidence, 'host-preload-renderer.json'), JSON.stringify({ checks,
    actualElectronIpc: false, sessionControllerTested: false, nativeCommandsExecuted: false }, null, 2));
}
