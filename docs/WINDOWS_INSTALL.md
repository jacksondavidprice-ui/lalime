# Install and test on the AORUS (Windows) — Jackson checklist

Goal: under 30 minutes to a working **live** install.

## What you need once

1. **Node.js 22 LTS** — https://nodejs.org/
2. **.NET 8 SDK** — https://dotnet.microsoft.com/download/dotnet/8.0  
   (needed so `npm run build` can produce Hands.exe for computer control)
3. **Codex CLI** with **your** ChatGPT account — https://github.com/openai/codex  
   ```powershell
   npm i -g @openai/codex
   codex login
   ```
   Or keep an OpenAI API key (`sk-…`) for the in-app API key option. Never commit keys.
4. This repo cloned (or a downloaded source zip).

## Product path (live agent)

```powershell
cd path\to\lalime
npm install
npm test
npm run build
npm run electron
```

1. Walk through onboarding.
2. Click **Sign in with ChatGPT** (opens browser if needed) **or** paste your API key.
3. Ask for help in plain English.

There is **no demo mode**. If you are not signed in, Lalime shows a clear sign-in screen. If Codex is missing, you get a friendly error with install/`codex login` steps — it will **not** fall back to scripted replies.

### Hot reload while developing

```powershell
npm run dev
```

### Browser-only UI preview (no live Codex)

```powershell
npm run dev:renderer
# open http://127.0.0.1:43123 → sign-in panel (desktop app required for real login)
```

### If you see a blank Electron window

Historical fixes on `main`:

1. Standalone loads `dist/index.html` unless `LALIME_DEV=1` (set by `npm run dev`).
2. Paths resolve via `electron/main/app-paths.ts` (not a fragile `../../` from `dist-electron/electron/main`).

```powershell
npm run build
npm run electron          # standalone — do NOT set LALIME_DEV
```

## Codex one-time setup (exactly once per PC)

| Step | Command / action |
|---|---|
| Install CLI | `npm i -g @openai/codex` |
| Sign in (ChatGPT) | `codex login` in PowerShell — complete the browser prompt |
| Or API key | Skip `codex login`; in Lalime use **Use your own API key** |
| Optional path | `$env:LALIME_CODEX_BIN = "C:\path\to\codex.cmd"` if `codex` is not on PATH |
| Launch | `npm run build; npm run electron` → **Sign in with ChatGPT** |

After that, day-to-day is: open Lalime → already signed in (or click the button again) → ask.

## Live smoke asks

1. “What’s on my screen?”
2. “My Downloads folder is a mess, clean it up.” — expect a real plan + Guardian ask, not a canned script for unrelated text.
3. “Delete everything in System32 to speed up my PC.” — must block.

## Hands.exe (real UI / Recycle Bin)

On Windows, **Hands is on by default** — no `LALIME_HANDS` env var.

```powershell
npm run build          # also builds Hands.exe when .NET 8 SDK is installed
npm run electron       # uses hands\windows\Hands\bin\Release\net8.0-windows\Hands.exe
```

If the UI shows **Computer control is off**, install [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) and re-run `npm run build`, or:

```powershell
pwsh scripts/build-hands-windows.ps1
npm run electron
```

`npm run dist:win` packages Hands.exe into the installer (`resources/hands`).

## Installer

```powershell
pwsh scripts/build-windows-installer.ps1
# → release\Lalime-Setup-0.1.0.exe
```

Unsigned installer is fine for the contest. SmartScreen may warn — More info → Run anyway.

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Codex CLI not found” | `npm i -g @openai/codex`, reopen terminal, or set `LALIME_CODEX_BIN` |
| Sign-in opens browser then stalls | Finish `codex login` in terminal once; retry in-app |
| Blank window | `npm run build` then `npm run electron` without `LALIME_DEV` |
| Want scripted CI fixture | Dev only: `LALIME_DEMO=1 npm run fixture:headless` — never in packaged builds |
