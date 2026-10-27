/** Trust-card checks use a synthetic bridge. No computer action is executed. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type { AppSnapshot, PendingApproval, ApprovalQueueEntry } from "../shared/types";
import type { LalimeApi } from "../shared/ipc";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43125";
const pending: PendingApproval = {
  action: { id: "preview-1", kind: "file_move", payload: "recycle:C:\\Samples\\report.txt",
    paths: ["C:\\Samples\\report.txt", "C:\\Samples\\photos"], userRequest: "Review sample files" },
  decision: { actionId: "preview-1", kind: "ask", tier: 2, plainEnglish: "Move these items to the Recycle Bin?",
    details: "Synthetic technical details", matchedRules: [], undoable: false },
};
const queue: ApprovalQueueEntry[] = [
  {actionId:"preview-1",kind:"file_move",summary:'Move "C:\\Samples\\report.txt"',tier:2,canAllowForTask:true},
  {actionId:"queued-2",kind:"shell",summary:'Run "Write-Output \\u201csample\\u201d"',tier:3,canAllowForTask:false},
  {actionId:"queued-3",kind:"ui_click",summary:'Click "Next\\n\\u202e" <strong>literal</strong>',tier:2,canAllowForTask:true},
  {actionId:"queued-4",kind:"file_write",summary:'Change "C:\\Samples\\note.txt"',tier:2,canAllowForTask:false},
];
const state: AppSnapshot = {
  mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
  messages: [], plan: [], activity: [], pendingApproval: pending, blockedNotice: null,
  running: true, stopped: false, statusText: "Waiting for your OK",
  hands: { backend: "node", available: true }, writer: { enabled: false, providerId: null, model: null },
};
type Harness = { holds: string[]; refuse: boolean; holdAllowed: boolean; calls: string[]; publish(patch: Partial<AppSnapshot>): void; fail: boolean };
async function fixture(browser: Browser, patch: Partial<AppSnapshot> = {}, reduced = false) {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, reducedMotion: reduced ? "reduce" : "no-preference" });
  page.setDefaultTimeout(4000);
  await page.addInitScript((initial: AppSnapshot) => {
    let current = initial;
    const subscribers = new Set<(s: AppSnapshot) => void>();
    const harness = { calls: [] as string[], holds: [] as string[], refuse: false, holdAllowed: true, fail: false, publish(patch: Partial<AppSnapshot>) {
      current = { ...current, ...patch }; for (const cb of subscribers) cb(current);
    } };
    const api: LalimeApi = {
      async getSnapshot() { return current; }, subscribe(cb) { subscribers.add(cb); return () => { subscribers.delete(cb); }; },
      async completeOnboarding() {}, async setMode() {}, async signInDemo() {}, async signInChatgpt() { return { ok: true }; },
      async signInApiKey() { return { ok: true }; }, async sendMessage(text) { harness.calls.push(`send:${text}`); },
      async respondApproval(choice, id) { harness.calls.push(`${choice}:${id}`); if (harness.fail) throw new Error("Synthetic failure"); return !harness.refuse; },
      async beginApprovalHold(id) { harness.holds.push(`begin:${id}`); return harness.holdAllowed; },
      async cancelApprovalHold(id) { harness.holds.push(`cancel:${id}`); },
      async revokeTaskGrant(id) { harness.calls.push(`revoke:${id}`); harness.publish({taskGrants:[]}); return true; },
      async undo() {}, async stop() { harness.calls.push("stop"); harness.publish({ stopped: true, running: false, pendingApproval: null, statusText: "Stopped" }); },
      async dismissBlocked() { harness.calls.push("dismiss"); harness.publish({ blockedNotice: null }); }, async runDemoScenario() {},
      async writerStatus() { return current.writer; },
      async updateSettings() { return { ok: true }; },
      async connectProvider() { return { ok: true }; }, async disconnect() {}, async copyText() {},
    };
    Object.defineProperty(window, "lalime", { value: api });
    Object.defineProperty(window, "trustHarness", { value: harness });
  }, { ...state, ...patch });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByTestId("chat-home").waitFor();
  return page;
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { trustHarness: Harness }).trustHarness.calls);
const hold = { ...pending, decision: { ...pending.decision, kind: "ask_hold" as const, tier: 3 as const } };
// A bounded wait verifies that cancelled timers cannot submit later.
async function elapse(page: Page, ms: number) {
  const until = await page.evaluate((duration) => performance.now() + duration, ms);
  await page.waitForFunction((deadline) => performance.now() >= deadline, until);
}
async function main() {
  await mkdir("artifacts/screenshots", { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL || undefined });
  const results: string[] = [];
  async function check(name: string, patch: Partial<AppSnapshot>, run: (p: Page) => Promise<void>, reduced = false) {
    if (process.env.TRUST_CASE && !name.includes(process.env.TRUST_CASE)) return;
    let page: Page | undefined;
    try { page = await fixture(browser, patch, reduced); await run(page); results.push(`PASS ${name}`); }
    catch (e) { results.push(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`); }
    finally { await page?.close(); }
    console.log(results.at(-1));
  }
  try {

    const hostilePayload="Write-Output 'safe\u202e\u200b\u{e0061}\u{e007f}'\r\nWrite-Output '<b>literal</b>\\u202e'";
    const safePayload="Write-Output 'safe\\u202e\\u200b\\u{e0061}\\u{e007f}'\r\nWrite-Output '<b>literal</b>\\u202e'";
    await check("batch7 tab-only leading lines do not hide the preview",{pendingApproval:{...pending,action:{...pending.action,kind:"shell",paths:[],payload:"\t\n\t\necho visible\n"+"echo details\n".repeat(5)}}},async(p)=>{
      const code=p.getByTestId("approval-payload");await code.waitFor();
      assert((await code.textContent())?.startsWith("echo visible\n"));
      await p.getByRole("button",{name:"Show full action",exact:true}).click();
      assert.equal(await code.textContent(),"\t\n\t\necho visible\n"+"echo details\n".repeat(5));
      assert.deepEqual(await calls(p),[]);
    });
    for(const kind of ["shell","powershell","file_write","open_settings","ui_click","ui_type"] as const){
      await check("batch7 every payload escapes controls and keeps line breaks: "+kind,{pendingApproval:{...pending,action:{...pending.action,kind,paths:[],payload:hostilePayload,summary:"Exact action"}}},async(p)=>{
        const code=p.getByTestId("approval-payload");await code.waitFor();
        assert.equal(await code.textContent(),safePayload);assert.equal(await code.locator("*").count(),0);
        const expand=p.getByRole("button",{name:"Show full action",exact:true});
        if(await expand.count()) {await expand.click();assert.equal(await code.textContent(),safePayload);}
        assert.deepEqual(await calls(p),[]);
      });
    }
    await check("batch7 blocked title escapes presentation controls",{pendingApproval:null,running:false,blockedNotice:{...pending.decision,kind:"block",tier:4,plainEnglish:"Blocked <b>safe</b>\n\u202e\u200b\u{e0061}\\u202e"}},async(p)=>{
      const title=p.getByTestId("blocked-card").getByRole("heading");await title.waitFor();
      assert.equal(await title.textContent(),"Blocked <b>safe</b>\\n\\u202e\\u200b\\u{e0061}\\u202e");
      assert.equal(await title.locator("*").count(),0);
    });
    const hugeQueue=Array.from({length:1000},(_,index)=>({...queue[0],actionId:index?`many-${index}`:pending.action.id,summary:`Step ${index}: ${"x".repeat(4000)}`}));
    for(const length of [1000,50]){
      await check("batch7 queue caps DOM with exact host count: "+length,{approvalQueue:hugeQueue.slice(0,length),pendingApprovalCount:1000},async(p)=>{
        await p.getByRole("button",{name:"999 more waiting",exact:true}).click();
        const list=p.getByRole("list",{name:"Approval queue",exact:true});await list.waitFor();
        assert.equal(await list.getByRole("listitem").count(),20);
        assert.deepEqual(await list.getByTestId("approval-queue-summary").allTextContents(),hugeQueue.slice(0,20).map(entry=>entry.summary));
        await p.getByText("and 980 more waiting",{exact:true}).waitFor();
        assert.equal(await list.locator('[tabindex="0"]').count(),20);assert.equal(await list.getByRole("button").count(),0);
        await list.getByRole("listitem").first().focus();await p.keyboard.press("End");
        assert(await list.getByRole("listitem").last().evaluate(el=>el===document.activeElement));
        assert.deepEqual(await calls(p),[]);
        await p.evaluate(patch=>(window as unknown as {trustHarness:Harness}).trustHarness.publish(patch),{approvalQueue:hugeQueue.slice(0,19),pendingApprovalCount:19});
        await p.getByRole("button",{name:"18 more waiting",exact:true}).waitFor();
        assert.equal(await list.getByRole("listitem").count(),19);assert.equal(await p.getByText("and 980 more waiting",{exact:true}).count(),0);
        await p.evaluate(()=>(window as unknown as {trustHarness:Harness}).trustHarness.publish({pendingApprovalCount:0,approvalQueue:[]}));
        assert.equal(await list.count(),0);assert.deepEqual(await calls(p),[]);
      });
    }
    await check("batch7 queue keyboard instructions describe the list",{approvalQueue:queue,pendingApprovalCount:4},async(p)=>{
      await p.getByRole("button",{name:"3 more waiting",exact:true}).click();
      const list=p.getByRole("list",{name:"Approval queue",exact:true});
      assert.equal(await list.evaluate(el=>(el.getAttribute("aria-describedby")??"").split(" ").map(id=>document.getElementById(id)?.textContent??"").join(" ")),"Use Up and Down to review, Home and End to jump, and Escape to close this preview.");
      await list.getByRole("listitem").first().focus();await p.keyboard.press("ArrowDown");
      assert(await list.getByRole("listitem").nth(1).evaluate(el=>el===document.activeElement));
      await p.keyboard.press("Escape");assert.deepEqual(await calls(p),[]);
      assert(await p.getByRole("button",{name:"3 more waiting",exact:true}).evaluate(el=>el===document.activeElement));
    },true);
    for(const reason of ["uses syntax Lalime can't check","This command uses syntax Lalime can't check for Allow-for-task.","This action requires confirmation each time."]){
      await check("batch7 unavailable reason clarifies one-time approval: "+reason,{pendingApproval:{...pending,canAllowForTask:false,grantUnavailableReason:reason}},async(p)=>{
        const note=p.getByTestId("grant-unavailable");await note.waitFor();
        assert.equal(await note.textContent(),reason+(reason.includes("can't check")?(reason.endsWith(".")?" ":". ")+"You can still approve it once.":""));
        assert.equal(await p.getByRole("button",{name:"Allow for this task",exact:true}).count(),0);
        await p.getByTestId("approval-do-it").click();assert.deepEqual(await calls(p),["do_it:preview-1"]);
      });
    }

    const fullCommand = `Write-Output '<strong>literal</strong>\n\u201cnext\u201d\u202e\u200b' ${"sample ".repeat(1000)}`;
    const escapedCommand = fullCommand.replace(/\n/g,"\\n").replace(/\u201c/g,"\\u201c").replace(/\u201d/g,"\\u201d").replace(/\u202e/g,"\\u202e").replace(/\u200b/g,"\\u200b");
    // Payloads keep real line breaks; summaries still show them as literal escapes.
    const displayedCommand = fullCommand.replace(/\u202e/g,"\\u202e").replace(/\u200b/g,"\\u200b");
    const capped = {...pending,summaryTruncated:true,summaryFullLength:escapedCommand.length+5,
      action:{...pending.action,kind:"shell" as const,paths:[],payload:fullCommand,summary:`Run: ${escapedCommand.slice(0,100)}...(+${escapedCommand.length-100} more)`}} as PendingApproval;
    const invisibleCodes=[0x00ad,0x180e,0x3164,0xffa0,0x115f,0xfff9,0xfffa,0xfffb,0xe0000,0xe007f];
    await check("batch6 cap invisible characters stay escaped in full text",{pendingApproval:{...capped,action:{...capped.action,payload:invisibleCodes.map(code=>`before${String.fromCodePoint(code)}after`).join(" ")}}},async(p)=>{
      await p.getByRole("button",{name:"Show full command",exact:true}).click();
      assert.equal(await p.getByRole("region",{name:"Full command",exact:true}).textContent(),invisibleCodes.map(code=>`before${code>0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4,"0")}`}after`).join(" "));
    });
    await check("batch6 cap full command is escaped read-only and scrollable",{pendingApproval:capped},async(p)=>{
      const toggle=p.getByRole("button",{name:"Show full command",exact:true});await toggle.waitFor();
      assert.equal(await toggle.getAttribute("aria-expanded"),"false");
      assert.equal(await p.getByTestId("approval-payload").count(),0);
      const marker=p.getByTestId("approval-summary-truncated");
      assert((await marker.textContent())?.includes(`...(+${escapedCommand.length-100} more)`));
      await toggle.focus();await p.keyboard.press("Enter");
      const full=p.getByRole("region",{name:"Full command",exact:true});await full.waitFor();
      assert.equal(await full.textContent(),displayedCommand);assert.equal(await full.locator("*").count(),0);
      assert.equal(await full.getAttribute("tabindex"),"0");
      assert(await full.evaluate(el=>!el.isContentEditable && el.scrollHeight>el.clientHeight && getComputedStyle(el).overflowY==="auto"));
      assert.deepEqual(await calls(p),[]);
      await full.focus();await p.keyboard.press("Escape");
      assert.equal(await full.count(),0);assert.deepEqual(await calls(p),[]);
      assert(await toggle.evaluate(el=>el===document.activeElement));
      await p.screenshot({path:"artifacts/screenshots/batch6-capped-command-mobile.png"});
    },true);
    await check("batch6 cap Escape from disclosure toggle closes only",{pendingApproval:capped},async(p)=>{
      await p.getByRole("button",{name:"Show full command",exact:true}).click();await p.keyboard.press("Escape");
      assert.equal(await p.getByRole("region",{name:"Full command",exact:true}).count(),0);
      assert.deepEqual(await calls(p),[]);
    });
    await check("batch6 cap incomplete metadata degrades without invented count",{pendingApproval:{...capped,summaryFullLength:undefined,action:{...capped.action,summary:"Run: partial preview"}} as PendingApproval},async(p)=>{
      await p.getByTestId("approval-summary-truncated").waitFor();
      assert.equal(await p.getByTestId("approval-summary-truncated").textContent(),"Preview shortened. Full text is available below.");
      await p.getByRole("button",{name:"Show full command",exact:true}).click();
      assert.equal(await p.getByRole("region",{name:"Full command",exact:true}).textContent(),displayedCommand);
    });
    await check("batch6 cap disclosure resets for next action",{pendingApproval:capped},async(p)=>{
      await p.getByRole("button",{name:"Show full command",exact:true}).click();
      await p.evaluate(patch=>(window as unknown as {trustHarness:Harness}).trustHarness.publish(patch),{pendingApproval:{...capped,action:{...capped.action,id:"next-capped"},decision:{...capped.decision,actionId:"next-capped"}}});
      await p.getByRole("button",{name:"Show full command",exact:true}).waitFor();
      assert.equal(await p.getByRole("region",{name:"Full command",exact:true}).count(),0);assert.deepEqual(await calls(p),[]);
    });
    await check("batch6 cap absent metadata keeps ordinary preview",{pendingApproval:pending},async(p)=>{
      assert.equal(await p.getByTestId("approval-summary-truncated").count(),0);
      assert.equal(await p.getByRole("button",{name:"Show full command",exact:true}).count(),0);
    });
    await check("batch6 cap queue stays plain text and view only",{approvalQueue:[queue[0],{...queue[1],summary:capped.action.summary!,summaryTruncated:true,summaryFullLength:escapedCommand.length+5} as ApprovalQueueEntry],pendingApprovalCount:2},async(p)=>{
      await p.getByRole("button",{name:"1 more waiting",exact:true}).click();
      const list=p.getByRole("list",{name:"Approval queue",exact:true});
      assert.equal(await list.getByTestId("approval-queue-summary").nth(1).textContent(),capped.action.summary);
      assert.equal(await list.getByRole("button").count(),0);assert.equal(await list.locator("strong").count(),0);
      assert.deepEqual(await calls(p),[]);
    });

    for(const [name,reason,expected] of [
      ["host reason","This action needs a fresh decision each time.","This action needs a fresh decision each time."],
      ["fallback",undefined,"Lalime will ask each time for this one."],
      ["blank reason","   ","Lalime will ask each time for this one."],
      ["literal reason",'Review <strong>each</strong> target\\nagain.','Review <strong>each</strong> target\\nagain.'],
    ]){
      await check('batch6 unavailable allowance '+name,{pendingApproval:{...pending,canAllowForTask:false,grantUnavailableReason:reason} as PendingApproval},async(p)=>{
        const note=p.getByTestId("grant-unavailable");await note.waitFor();
        assert.equal(await note.textContent(),expected);assert.equal(await note.locator("*").count(),0);
        assert.equal(await p.getByRole("alert").count(),0);
        assert.equal(await p.getByRole("button",{name:"Allow for this task",exact:true}).count(),0);
        assert(await p.getByTestId("approval-do-it").isEnabled());
      });
    }
    for(const eligible of [true,undefined]){
      await check('batch6 no unavailable note for '+eligible,{pendingApproval:{...pending,canAllowForTask:eligible,grantUnavailableReason:"Stale reason"} as PendingApproval},async(p)=>{
        assert.equal(await p.getByTestId("grant-unavailable").count(),0);
      });
    }
    await check("batch6 unavailable reason clears when host permits grant",{pendingApproval:{...pending,canAllowForTask:false}},async(p)=>{
      await p.getByTestId("grant-unavailable").waitFor();
      await p.evaluate(patch=>(window as unknown as {trustHarness:Harness}).trustHarness.publish(patch),{pendingApproval:{...pending,canAllowForTask:true}});
      assert.equal(await p.getByTestId("grant-unavailable").count(),0);
      await p.getByRole("button",{name:"Allow for this task",exact:true}).waitFor();
    });

    await check("batch5 Escape from queue toggle only closes preview",{approvalQueue:queue,pendingApprovalCount:4},async(p)=>{
      const toggle=p.getByRole("button",{name:"3 more waiting",exact:true});await toggle.click();
      await p.keyboard.press("Escape"); assert.deepEqual(await calls(p),[]);
      assert.equal(await toggle.getAttribute("aria-expanded"),"false");
      assert(await toggle.evaluate(el=>el===document.activeElement));
    });

    await check("batch5 Escape closes queue without replying",{approvalQueue:queue,pendingApprovalCount:4},async(p)=>{
      const toggle=p.getByRole("button",{name:"3 more waiting",exact:true});await toggle.click();
      await p.getByRole("list",{name:"Approval queue",exact:true}).getByRole("listitem").nth(1).focus();
      await p.keyboard.press("Escape");
      assert.deepEqual(await calls(p),[]);
      assert.equal(await toggle.getAttribute("aria-expanded"),"false");
      assert(await toggle.evaluate(el=>el===document.activeElement));
    });

    await check("batch5 exact FIFO queue is view-only and keyboard navigable", {approvalQueue:queue,pendingApprovalCount:4},async(p)=>{
      await p.getByRole("button",{name:"3 more waiting",exact:true}).click();
      const list=p.getByRole("list",{name:"Approval queue",exact:true}); await list.waitFor();
      const rows=list.getByRole("listitem"); assert.equal(await rows.count(),4);
      assert.deepEqual(await list.getByTestId("approval-queue-summary").allTextContents(),queue.map(x=>x.summary));
      assert.equal(await rows.nth(0).getAttribute("aria-current"),"step");
      await rows.nth(1).getByText("Risk level 3",{exact:true}).waitFor();
      assert.equal(await list.getByText("Can allow for this task",{exact:true}).count(),2);
      assert.equal(await list.getByRole("button").count(),0);
      await rows.nth(0).focus(); await p.keyboard.press("ArrowDown");
      assert(await rows.nth(1).evaluate(el=>el===document.activeElement));
      await p.keyboard.press("End"); assert(await rows.nth(3).evaluate(el=>el===document.activeElement));
      await p.keyboard.press("Home"); await p.keyboard.press("Enter"); await p.keyboard.press("Space");
      assert.deepEqual(await calls(p),[]);
      assert.equal(await list.locator("strong").count(),0);
      await p.waitForFunction(() => { const card=document.querySelector('[data-testid="approval-card"]'); return card && getComputedStyle(card).transform === "none"; });
      await list.evaluate(el => { el.scrollTop = 0; });
      await p.screenshot({path:"artifacts/screenshots/batch5-queue-mobile.png"});
    });
    await check("batch5 queue updates live and removes stale summaries", {approvalQueue:queue,pendingApprovalCount:4},async(p)=>{
      await p.getByRole("button",{name:"3 more waiting",exact:true}).click();
      await p.getByRole("list",{name:"Approval queue",exact:true}).waitFor();
      const changed=[queue[0],{...queue[2],summary:'Click "Updated target"'}];
      await p.evaluate(patch=>(window as unknown as {trustHarness:Harness}).trustHarness.publish(patch),{approvalQueue:changed,pendingApprovalCount:2});
      await p.getByRole("button",{name:"1 more waiting",exact:true}).waitFor();
      assert.deepEqual(await p.getByTestId("approval-queue-summary").allTextContents(),changed.map(x=>x.summary));
      assert.deepEqual(await calls(p),[]);
    });
    await check("batch5 queue promotion cannot approve a later entry", {approvalQueue:queue,pendingApprovalCount:4},async(p)=>{
      await p.getByRole("button",{name:"3 more waiting",exact:true}).click();
      await p.getByRole("list",{name:"Approval queue",exact:true}).waitFor();
      const next={...pending,action:{...pending.action,id:queue[1].actionId},decision:{...pending.decision,actionId:queue[1].actionId}};
      await p.evaluate(patch=>(window as unknown as {trustHarness:Harness}).trustHarness.publish(patch),{pendingApproval:next,approvalQueue:queue.slice(1),pendingApprovalCount:3});
      await p.getByRole("button",{name:"2 more waiting",exact:true}).click();
      assert.deepEqual(await p.getByTestId("approval-queue-summary").allTextContents(),queue.slice(1).map(x=>x.summary));
      await p.getByTestId("approval-not-now").click(); assert.deepEqual(await calls(p),["not_now:queued-2"]);
    });
    await check("batch5 queue invalidation clears previews", {approvalQueue:queue,pendingApprovalCount:4},async(p)=>{
      await p.getByRole("button",{name:"3 more waiting",exact:true}).click();
      await p.getByRole("list",{name:"Approval queue",exact:true}).waitFor();
      await p.evaluate(()=>(window as unknown as {trustHarness:Harness}).trustHarness.publish({pendingApproval:null,approvalQueue:[],pendingApprovalCount:0}));
      await p.getByTestId("approval-card").waitFor({state:"hidden"});
      assert.equal(await p.getByTestId("approval-queue-summary").count(),0); assert.deepEqual(await calls(p),[]);
    });
    await check("batch5 mismatched queue cannot expose old previews", {approvalQueue:queue,pendingApprovalCount:4},async(p)=>{
      await p.getByRole("button",{name:"3 more waiting",exact:true}).click();
      await p.getByRole("list",{name:"Approval queue",exact:true}).waitFor();
      await p.evaluate(patch=>(window as unknown as {trustHarness:Harness}).trustHarness.publish(patch),{approvalQueue:queue.slice(1)});
      assert.equal(await p.getByTestId("approval-queue-summary").count(),0);
    });
    for(const [name, testId, key, choice] of [
      ["Do it click","approval-do-it","","do_it"], ["Not now click","approval-not-now","","not_now"],
      ["Do it Enter","approval-do-it","Enter","do_it"], ["Do it Space","approval-do-it","Space","do_it"],
      ["Not now Enter","approval-not-now","Enter","not_now"], ["card Escape","approval-do-it","Escape","not_now"],
      ["Allowance Enter","","Enter","allow_for_task"], ["Allowance click","","","allow_for_task"],
    ]) {
      await check('batch5 displayed ID on ' + name,{pendingApproval:{...pending,canAllowForTask:true,action:{...pending.action,id:"displayed-52"},decision:{...pending.decision,actionId:"displayed-52"}}},async(p)=>{
        const button=testId?p.getByTestId(testId):p.getByRole("button",{name:"Allow for this task",exact:true});
        if(key){await button.focus();await p.keyboard.press(key);}else await button.click();
        assert.deepEqual(await calls(p),[choice+":displayed-52"]);
      });
    }
    await check("batch5 window focus does not answer a notification approval",{},async(p)=>{
      await p.evaluate(()=>{window.dispatchEvent(new Event("blur"));window.dispatchEvent(new Event("focus"));});
      assert.deepEqual(await calls(p),[]);
    });

    await check("batch4 active command grants can be reviewed and revoked", {pendingApproval:null,running:false,
      taskGrants:[{id:"command-grant",kind:"powershell",target:"Write-Output 'sample' in C:\\Samples"}]},async(p)=>{
      await p.getByRole("button",{name:"Open plan and activity",exact:true}).click();
      const grants=p.getByRole("dialog",{name:"Plan and activity",exact:true}).getByTestId("task-grants");
      await grants.getByText("Only the exact actions shown are allowed during this task. Stop or a new task clears these allowances.",{exact:true}).waitFor();
      await grants.getByText("Write-Output 'sample' in C:\\Samples",{exact:true}).waitFor();
      await grants.getByRole("button",{name:"Revoke",exact:true}).click();
      await grants.waitFor({state:"hidden"}); assert.deepEqual(await calls(p),["revoke:command-grant"]);
    });

    for (const kind of ["shell", "powershell", "file_read", "file_write", "file_move", "file_delete", "ui_click", "ui_type", "open_settings", "screenshot", "sysinfo"] as const) {
      for (const eligibility of [true, false, undefined]) {
        await check('batch4 host eligibility ' + kind + ' ' + eligibility, { pendingApproval: { ...pending,
          canAllowForTask: eligibility, action: { ...pending.action, kind },
        } }, async(p)=>{
          const button=p.getByRole("button", {name:"Allow for this task",exact:true});
          if(eligibility === true) { await button.click(); assert.deepEqual(await calls(p),["allow_for_task:preview-1"]); }
          else { assert.equal(await button.count(),0); assert.deepEqual(await calls(p),[]); }
        });
      }
    }
    await check("batch4 host eligibility has no renderer tier override", { pendingApproval: {
      ...pending, canAllowForTask:true, decision:{...pending.decision,tier:3},
    } }, async(p)=>{
      await p.getByRole("button",{name:"Allow for this task",exact:true}).click();
      assert.deepEqual(await calls(p),["allow_for_task:preview-1"]);
    });
    for(const kind of ["shell","file_write","file_move","ui_click"] as const) {
      await check('batch4 plain grant scope ' + kind, {pendingApproval:{...pending,canAllowForTask:true,action:{...pending.action,kind}}},async(p)=>{
        const expected=kind === "shell" ? "Lalime can run this exact command again without asking until this task ends."
          : kind.startsWith("file_") ? "Lalime can repeat this exact action on these same items without asking until this task ends."
          : "Lalime can repeat this exact step without asking until this task ends.";
        await p.getByText(expected,{exact:true}).waitFor();
        await p.getByText("Open Plan and activity to review or revoke allowances.",{exact:true}).waitFor();
        if(kind === "shell") { await p.getByText(expected,{exact:true}).scrollIntoViewIfNeeded(); await p.screenshot({path:"artifacts/screenshots/batch4-command-grant-mobile.png"}); }
        assert.deepEqual(await calls(p),[]);
      },true);
    }

    await check("batch3 invalidated hold preparation is calm", {pendingApproval:hold},async(p)=>{
      await p.evaluate(()=>{const api=(window as unknown as {lalime:LalimeApi}).lalime;
        api.beginApprovalHold=async()=>false; const original=api.getSnapshot;
        api.getSnapshot=async()=>({...await original(),pendingApproval:null,pendingApprovalCount:0});
      });
      await p.getByTestId("approval-do-it").focus(); await p.keyboard.down("Space");
      await p.getByText("No longer valid",{exact:true}).waitFor(); await p.keyboard.up("Space");
      assert.equal(await p.getByRole("alert").count(),0); assert.deepEqual(await calls(p),[]);
    });

    await check("batch3 Arabic direction control stays visibly escaped", { pendingApproval: { ...pending,
      action: { ...pending.action, kind: "ui_click", paths: [], summary: 'Click "Next\u061c"', payload: '{"name":"Next\u061c"}' },
    } }, async(p)=>{
      await p.getByTestId("approval-summary").waitFor();
      assert.equal(await p.getByTestId("approval-summary").textContent(), 'Click "Next\\u061c"');
      assert.equal(await p.getByTestId("approval-payload").textContent(), '{"name":"Next\\u061c"}');
    });

    for (const [name, summary] of [
      ["newline", 'Click target "Next\\nApprove all" in window "Sample"'],
      ["quotes", 'Click target "\\u201cNext\\u201d" in window "Sample"'],
      ["direction", 'Click target "safe\\u202eevil\\u200b" in window "Sample"'],
    ]) {
      await check('batch3 summary preserves literal ' + name, { pendingApproval: { ...pending,
        assistantExplanation: "Assistant rationale", action: { ...pending.action, kind: "ui_click", paths: [], summary, payload: '{"name":"sample"}' },
      } }, async (p) => {
        const preview = p.getByTestId("approval-summary"); await preview.waitFor();
        assert.equal(await preview.textContent(), summary);
        assert.equal(await preview.locator("*").count(), 0);
        if (name === "direction") await p.screenshot({path:"artifacts/screenshots/batch3-summary-mobile.png"});
      });
    }
    await check("batch3 raw summary controls cannot spoof layout", { pendingApproval: { ...pending,
      action: { ...pending.action, kind: "ui_click", paths: [], summary: 'Click "Next\n\u201c\u202e\u200b"', payload: '{}' },
    } }, async (p) => {
      await p.getByTestId("approval-summary").waitFor();
      assert.equal(await p.getByTestId("approval-summary").textContent(), 'Click "Next\\n\u201c\\u202e\\u200b"');
    });
    await check("batch3 bulk recycle explains hold and cannot use plain approval", { pendingApproval: {
      ...hold, canAllowForTask: false, action: { ...hold.action, paths: Array.from({length:140}, (_,i)=>'C:\\Samples\\item-'+i) },
      decision: { ...hold.decision, matchedRules: ["host.bulk_recycle_hold"] },
    } }, async (p) => {
      await p.getByText("This moves 140 items. Press and hold to confirm.", {exact:true}).waitFor();
      assert.equal(await p.getByRole("button", {name:"Do it",exact:true}).count(),0);
      assert.equal(await p.getByRole("button", {name:"Allow for this task",exact:true}).count(),0);
      await p.getByTestId("approval-do-it").click(); assert.deepEqual(await calls(p),[]);
    });
    for (const kind of ["shell", "powershell", "file_write", "file_move", "file_delete"] as const) {
      await check('batch3 post block hold explains ' + kind, { pendingApproval: { ...hold,
        action: { ...hold.action, kind, paths: [], payload: "sample" },
        decision: { ...hold.decision, matchedRules: ["host.after_never_block_hold"] },
      } }, async(p)=>{
        await p.getByText("Lalime blocked something risky earlier in this task, so the next changes need a press-and-hold.", {exact:true}).waitFor();
        assert.equal(await p.getByRole("button", {name:"Do it",exact:true}).count(),0);
      });
    }
    await check("batch3 queue overview is keyboard accessible and honest", { pendingApprovalCount:4 }, async(p)=>{
      const toggle=p.getByRole("button",{name:"3 more waiting",exact:true}); await toggle.focus(); await p.keyboard.press("Enter");
      assert.equal(await toggle.getAttribute("aria-expanded"),"true");
      await p.getByText("You will review each step and its exact details before deciding.",{exact:true}).waitFor();
      assert.deepEqual(await calls(p),[]);
      await p.screenshot({path:"artifacts/screenshots/batch3-queue-mobile.png"});
      await p.keyboard.press("Enter");
      assert.equal(await toggle.getAttribute("aria-expanded"),"false");
    });
    await check("batch3 invalidated response is calm and cannot retry stale action", {}, async(p)=>{
      await p.evaluate(()=>{const api=(window as unknown as {lalime:LalimeApi}).lalime;
        api.respondApproval=async()=>false; const original=api.getSnapshot;
        api.getSnapshot=async()=>({...await original(),pendingApproval:null,pendingApprovalCount:0});
      });
      await p.getByTestId("approval-do-it").click();
      await p.getByText("No longer valid",{exact:true}).waitFor();
      assert.equal(await p.getByRole("alert").count(),0);
      assert(await p.getByTestId("approval-do-it").isDisabled());
    });
    await check("batch3 host invalidation removes cards and grants", {pendingApproval:hold,pendingApprovalCount:4},async(p)=>{
      await p.getByTestId("approval-do-it").focus(); await p.keyboard.down("Space");
      await p.evaluate(()=> (window as unknown as {trustHarness:Harness}).trustHarness.publish({pendingApproval:null,pendingApprovalCount:0,taskGrants:[]}));
      await p.getByTestId("approval-card").waitFor({state:"hidden"}); await p.keyboard.up("Space");
      assert.deepEqual(await calls(p),[]); assert.equal(await p.getByRole("alert").count(),0);
    });
    for (const reduced of [false,true]) {
      await check('batch3 accepted hold has calm completion ' + reduced, {pendingApproval:hold},async(p)=>{
        const button=p.getByTestId("approval-do-it");
        if(reduced){await button.click();await elapse(p,2100);await button.click();}
        else {await button.focus();await p.keyboard.down("Space");await elapse(p,1650);await p.keyboard.up("Space");}
        await p.getByText("Confirmed",{exact:true}).waitFor();
        assert.deepEqual(await calls(p),["hold_confirmed:preview-1"]);
        assert(await button.isDisabled());
        if(reduced) assert.equal(await p.getByTestId("approval-complete").evaluate(el=>getComputedStyle(el).transform),"none");
      },reduced);
    }

    await check("preview skips blank leading lines but expands the exact command", { pendingApproval: { ...pending, action: { ...pending.action, kind: "shell", paths: [], payload: "\n  \n  echo visible\n" + "echo details\n".repeat(5) } } }, async (p) => {
      assert((await p.getByTestId("approval-payload").textContent())?.startsWith("  echo visible"));
      await p.getByRole("button", { name: "Show full action", exact: true }).click();
      assert((await p.getByTestId("approval-payload").textContent())?.startsWith("\n  \n  echo visible"));
    });
    await check("batch approval headline shows the target count", {}, async (p) => {
      assert.match(await p.getByRole("heading", { level: 2 }).first().innerText(), /2 items/);
    });
    await check("hold cannot confirm before host acknowledgement", { pendingApproval: hold }, async (p) => {
      await p.evaluate(() => { (window as unknown as { lalime: LalimeApi }).lalime.beginApprovalHold = () => new Promise(resolve => setTimeout(() => resolve(true), 1800)); });
      await p.getByTestId("approval-do-it").focus(); await p.keyboard.down("Space");
      await elapse(p, 1600); await p.keyboard.up("Space"); await elapse(p, 1900);
      assert.deepEqual(await calls(p), []);
    });
    await check("hold fails closed without host support", { pendingApproval: hold }, async (p) => {
      await p.evaluate(() => { (window as unknown as { lalime: LalimeApi }).lalime.beginApprovalHold = undefined; });
      await p.getByTestId("approval-do-it").focus(); await p.keyboard.down("Space");
      await p.getByRole("alert").waitFor(); await elapse(p, 1600); await p.keyboard.up("Space");
      assert.deepEqual(await calls(p), []);
    });
    await check("queue shows authoritative remaining approvals", { pendingApprovalCount: 4 }, async (p) => {
      await p.getByText("3 more waiting", { exact: true }).waitFor();
    });
    await check("queue does not invent waiting approvals", { pendingApprovalCount: 1 }, async (p) => {
      assert.equal(await p.getByText(/more waiting/).count(), 0);
    });
    await check("hold starts and cancels the host timer for the exact action", { pendingApproval: hold }, async (p) => {
      await p.getByTestId("approval-do-it").focus(); await p.keyboard.down("Space");
      await p.waitForFunction(() => (window as unknown as { trustHarness: Harness }).trustHarness.holds.includes("begin:preview-1"));
      await p.keyboard.up("Space");
      assert.deepEqual(await p.evaluate(() => (window as unknown as { trustHarness: Harness }).trustHarness.holds), ["begin:preview-1", "cancel:preview-1"]);
      assert.deepEqual(await calls(p), []);
    });
    await check("refused host hold never enables confirmation", { pendingApproval: hold }, async (p) => {
      await p.evaluate(() => { (window as unknown as { trustHarness: Harness }).trustHarness.holdAllowed = false; });
      await p.getByTestId("approval-do-it").focus(); await p.keyboard.down("Space");
      await p.getByRole("alert").waitFor(); await elapse(p, 1700); await p.keyboard.up("Space");
      assert.deepEqual(await calls(p), []);
    });
    await check("host refused approval remains retryable", {}, async (p) => {
      await p.evaluate(() => { (window as unknown as { trustHarness: Harness }).trustHarness.refuse = true; });
      await p.getByTestId("approval-do-it").click(); await p.getByRole("alert").waitFor();
      assert(await p.getByTestId("approval-do-it").isEnabled());
    });
    await check("allow for task is offered only with host eligibility for tier2 UI", { pendingApproval: {
      ...pending, canAllowForTask: true, action: { ...pending.action, kind: "ui_click", payload: '{"name":"Next"}', paths: undefined },
    } }, async (p) => {
      await p.getByRole("button", { name: "Allow for this task", exact: true }).click();
      assert.deepEqual(await calls(p), ["allow_for_task:preview-1"]);
    });
    for (const [name, approval] of [["no host grant", { ...pending, canAllowForTask: false }],
      ["ineligible file operation", { ...pending, canAllowForTask: false }],
      ["ineligible higher risk", { ...hold, canAllowForTask: false, action: { ...hold.action, kind: "ui_click" as const } }]] as const) {
      await check(`allow for task stays hidden for ${name}`, { pendingApproval: approval }, async (p) => {
        assert.equal(await p.getByRole("button", { name: "Allow for this task", exact: true }).count(), 0);
      });
    }
    for (const length of [110, 500]) {
      await check(`payload actually clamps to two lines at ${length} characters`, { pendingApproval: {
        action: { ...pending.action, kind: "shell", payload: "echo " + "x".repeat(length), paths: undefined }, decision: pending.decision,
      } }, async (p) => {
        const payload = p.getByTestId("approval-payload"); await payload.waitFor();
        const dimensions = await payload.evaluate((el) => ({ height: el.clientHeight, line: parseFloat(getComputedStyle(el).lineHeight) }));
        assert(dimensions.height <= dimensions.line * 2 + 2, `Preview must show at most two lines: ${JSON.stringify(dimensions)}`);
        await p.getByRole("button", { name: "Show full action", exact: true }).click();
        assert((await payload.textContent())?.endsWith("x".repeat(length)));
      });
    }
    await check("command preview resists a deceptive assistant headline", { pendingApproval: {
      action: { ...pending.action, kind: "powershell", payload: "Remove-Item -Recurse -Force $env:USERPROFILE\\Documents\nWrite-Output 'complete'", paths: undefined, summary: "Clear the browser cache", cwd: "C:\\Samples" },
      decision: { ...pending.decision, plainEnglish: "Clear the browser cache" }, whatHappens: "This only cleans temporary files.",
    } }, async (p) => {
      const card = p.getByRole("alertdialog");
      assert.equal(await card.getByRole("heading").textContent(), "Run a PowerShell command?");
      const command = card.getByTestId("approval-payload"); await command.waitFor();
      assert((await command.textContent())?.includes("Remove-Item -Recurse -Force $env:USERPROFILE\\Documents"));
      await card.getByText("C:\\Samples", { exact: true }).waitFor();
      await card.getByRole("button", { name: "Show full action", exact: true }).click();
      assert.equal(await command.evaluate((el) => getComputedStyle(el).webkitLineClamp), "none");
      assert((await command.textContent())?.includes("Write-Output 'complete'"));
      assert.deepEqual(await calls(p), []);
    });
    await check("click preview uses payload rather than the assistant summary", { pendingApproval: {
      action: { ...pending.action, kind: "ui_click", payload: '{"name":"Delete","windowTitle":"Files"}', paths: undefined, summary: "Just view a file" },
      decision: { ...pending.decision, plainEnglish: "Just view a file" },
    } }, async (p) => {
      const card = p.getByRole("alertdialog");
      assert.equal(await card.getByRole("heading").textContent(), "Click a control on your computer?");
      assert((await card.getByTestId("approval-payload").textContent())?.includes('"name":"Delete"'));
    });
    await check("about panel identifies the author license and source", { pendingApproval: null, running: false }, async (p) => {
      await p.getByTestId("settings-button").click();
      const panel = p.getByTestId("about-panel"); await panel.waitFor();
      await panel.getByText("Made by Jackson Price. Open source", { exact: true }).waitFor();
      await panel.getByText("MIT License", { exact: true }).waitFor();
      assert.equal(await panel.getByRole("link", { name: "View source on GitHub" }).getAttribute("href"), "https://github.com/jacksondavidprice-ui/lalime");
    });
    await check("approval previews exact targets and focuses the safe heading", {}, async (p) => {
      const card = p.getByRole("alertdialog"); await card.waitFor();
      assert(await card.evaluate((el) => el.contains(document.activeElement)));
      assert.equal(await card.getAttribute("aria-modal"), "false");
      await card.getByText("C:\\Samples\\report.txt", { exact: true }).waitFor();
      await card.getByText("C:\\Samples\\photos", { exact: true }).waitFor();
      await card.getByText("2 items", { exact: true }).waitFor();
      await card.getByText("Risk level 2", { exact: true }).waitFor();
      await card.getByText("This step will not run. Lalime may continue with other steps.").waitFor();
      assert.equal(await card.locator("pre:visible").count(), 0);
      await p.screenshot({ path: "artifacts/screenshots/trust-preview-mobile.png" });
      await p.keyboard.press("Escape"); assert.deepEqual(await calls(p), ["not_now:preview-1"]);
    });
    await check("normal approval sends once with the action ID", {}, async (p) => {
      await p.getByTestId("approval-do-it").dblclick();
      assert.deepEqual(await calls(p), ["do_it:preview-1"]);
    });
    await check("approval heading stays visible above a tall preview", {}, async (p) => {
      const heading = p.getByRole("alertdialog").getByRole("heading");
      await heading.waitFor(); await elapse(p, 300);
      const h = (await heading.boundingBox())!;
      const header = (await p.locator("header").boundingBox())!;
      assert(h.y >= header.y + header.height, `Approval heading ${h.y} is hidden behind header ${header.y + header.height}`);
    });
    await check("hold rejects a click and a short key press", { pendingApproval: hold }, async (p) => {
      const button = p.getByTestId("approval-do-it"); await button.click();
      await button.focus(); await p.keyboard.press("Enter"); await elapse(p, 1700);
      assert.deepEqual(await calls(p), []);
    });
    await check("hold confirms only after a sustained keyboard hold and release", { pendingApproval: hold }, async (p) => {
      await p.getByTestId("approval-do-it").focus(); await p.keyboard.down("Space");
      await p.getByText("Release to confirm.", { exact: true }).waitFor();
      assert.deepEqual(await calls(p), []); await p.keyboard.up("Space");
      assert.deepEqual(await calls(p), ["hold_confirmed:preview-1"]);
    });
    await check("hold cancels when pointer leaves", { pendingApproval: hold }, async (p) => {
      const button = p.getByTestId("approval-do-it"); await button.scrollIntoViewIfNeeded();
      const b = (await button.boundingBox())!; await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down();
      await p.mouse.move(1, 1); await elapse(p, 1700); await p.mouse.up();
      assert.deepEqual(await calls(p), []);
    });
    await check("hold is cancelled when the action is replaced", { pendingApproval: hold }, async (p) => {
      await p.getByTestId("approval-do-it").focus(); await p.keyboard.down("Enter");
      await p.evaluate((next) => (window as unknown as { trustHarness: Harness }).trustHarness.publish({ pendingApproval: next }),
        { ...hold, action: { ...hold.action, id: "replacement" }, decision: { ...hold.decision, actionId: "replacement" } });
      await elapse(p, 1700); await p.keyboard.up("Enter"); assert.deepEqual(await calls(p), []);
    });
    await check("reduced motion arms but never auto-confirms", { pendingApproval: hold }, async (p) => {
      await p.getByTestId("approval-do-it").click(); await elapse(p, 2200);
      assert.deepEqual(await calls(p), []);
      await p.getByRole("button", { name: "Confirm this step", exact: true }).click();
      assert.deepEqual(await calls(p), ["hold_confirmed:preview-1"]);
    }, true);
    await check("reduced motion ignores key repeats during arming", { pendingApproval: hold }, async (p) => {
      await p.getByTestId("approval-do-it").focus(); await p.keyboard.down("Enter");
      await elapse(p, 2200); await p.keyboard.down("Enter"); await p.keyboard.up("Enter");
      assert.deepEqual(await calls(p), []);
    }, true);
    await check("pointer hold confirms once on release", { pendingApproval: hold }, async (p) => {
      const button = p.getByTestId("approval-do-it"); await button.scrollIntoViewIfNeeded();
      const b = (await button.boundingBox())!; await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down();
      await p.getByText("Release to confirm.", { exact: true }).waitFor();
      assert.deepEqual(await calls(p), []); await p.mouse.up(); assert.deepEqual(await calls(p), ["hold_confirmed:preview-1"]);
    });
    await check("touch hold cancels after dragging outside captured button", { pendingApproval: hold }, async (p) => {
      const button = p.getByTestId("approval-do-it"); await button.scrollIntoViewIfNeeded();
      const b = (await button.boundingBox())!;
      await button.dispatchEvent("pointerdown", { pointerId: 9, pointerType: "touch", button: 0, clientX: b.x + 10, clientY: b.y + 10 });
      await button.dispatchEvent("pointermove", { pointerId: 9, pointerType: "touch", clientX: 1, clientY: 1 });
      await elapse(p, 1700);
      await button.dispatchEvent("pointerup", { pointerId: 9, pointerType: "touch", clientX: 1, clientY: 1 });
      assert.deepEqual(await calls(p), []);
    });
    await check("click-only access can choose two-step confirmation", { pendingApproval: hold }, async (p) => {
      await p.getByRole("button", { name: "Use two-step confirmation", exact: true }).dispatchEvent("click");
      await p.getByTestId("approval-do-it").dispatchEvent("click"); await elapse(p, 2200);
      assert.deepEqual(await calls(p), []);
      await p.getByRole("button", { name: "Confirm this step", exact: true }).dispatchEvent("click");
      assert.deepEqual(await calls(p), ["hold_confirmed:preview-1"]);
    });
    await check("keyboard hold cancels on blur", { pendingApproval: hold }, async (p) => {
      await p.getByTestId("approval-do-it").focus(); await p.keyboard.down("Enter");
      await p.getByTestId("approval-not-now").focus(); await elapse(p, 1700); await p.keyboard.up("Enter");
      assert.deepEqual(await calls(p), []);
    });
    await check("settings preview shows the real target", { pendingApproval: { ...pending, action: { ...pending.action,
      kind: "open_settings", payload: "ms-settings:nightlight", paths: undefined } } }, async (p) => {
      await p.getByRole("alertdialog").getByText("ms-settings:nightlight", { exact: true }).waitFor();
      assert.equal(await p.getByText("To the Recycle Bin", { exact: true }).count(), 0);
    });
    await check("blocked alternative waits until the active turn settles", { pendingApproval: null,
      blockedNotice: { ...pending.decision, kind: "block", tier: 4 } }, async (p) => {
      assert(await p.getByRole("button", { name: "Try a safer way", exact: true }).isDisabled());
      assert.deepEqual(await calls(p), []);
    });
    await check("approval failure is visible and retryable", {}, async (p) => {
      await p.evaluate(() => { (window as unknown as { trustHarness: Harness }).trustHarness.fail = true; });
      await p.getByTestId("approval-do-it").click(); await p.getByRole("alert").waitFor();
      assert(await p.getByTestId("approval-do-it").isEnabled());
    });
    await check("blocked details stay collapsed and safer follow-up uses messaging", {
      pendingApproval: null, running: false, statusText: "Guardian blocked this step", blockedNotice: { ...pending.decision, kind: "block", tier: 4,
        plainEnglish: "This could damage your files." },
    }, async (p) => {
      const card = p.getByTestId("blocked-card"); assert.equal(await card.locator("pre:visible").count(), 0);
      await p.screenshot({ path: "artifacts/screenshots/trust-blocked-mobile.png" });
      await card.getByText("Details for helpers", { exact: true }).click(); await card.locator("pre").waitFor();
      await card.getByRole("button", { name: "Try a safer way", exact: true }).click();
      const log = await calls(p); assert(log.some((x) => x.startsWith("send:") && x.includes("safer")));
      assert(!log.some((x) => x.startsWith("do_it")));
    });
    await check("Stop and stopped actions preserve review before sending", { pendingApproval: null }, async (p) => {
      await p.getByTestId("stop-button").click(); const card = p.getByTestId("stopped-card"); await card.waitFor();
      await card.getByRole("button", { name: "Continue", exact: true }).click();
      assert((await p.getByTestId("chat-input").inputValue()).length > 0);
      assert.deepEqual(await calls(p), ["stop"]);
      await card.getByRole("button", { name: "Start over", exact: true }).click();
      assert.equal(await p.getByTestId("chat-input").inputValue(), "");
      assert(await p.getByTestId("chat-input").evaluate((el) => el === document.activeElement));
      await p.waitForFunction(() => {
        const status = document.querySelector('[data-testid="status-text"]');
        return status?.textContent === "Stopped" && Array.from(status.children).every((el) => getComputedStyle(el).opacity === "1");
      });
      await p.screenshot({ path: "artifacts/screenshots/trust-stopped-mobile.png" });
    });
    for (const surface of ["Settings", "Plan and activity"]) {
      await check(`Stop stays reachable inside ${surface}`, { pendingApproval: null }, async (p) => {
        await p.getByRole("button", { name: surface === "Settings" ? "Settings" : "Open plan and activity", exact: true }).click();
        const dialog = p.getByRole("dialog", { name: surface, exact: true });
        await dialog.getByTestId("stop-button").click(); assert.deepEqual(await calls(p), ["stop"]);
      });
    }
  } finally { await browser.close(); }
  await writeFile("artifacts/ui-trust-result.txt", `Command: ${process.argv.join(" ")}\nURL: ${BASE}\nBrowser: ${process.env.LALIME_BROWSER_CHANNEL || "chromium"}\n${results.join("\n")}\n`);
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
}
void main();
