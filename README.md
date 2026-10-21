# Lalime

**Your computer, done for you, safely.**

Windows-first desktop app (Electron). You ask in plain English; Lalime plans and acts with the **live Codex agent**. Every risky step goes through **Guardian**. Undo stays nearby.

Congressional App Challenge 2026 — **Jackson Price** (solo), TX-37.

There is **no demo mode** in the product. Every person signs in with **their own ChatGPT account** (Codex) or pastes **their own OpenAI API key**. Lalime never ships a shared login or scripted replies.

Optional **better writing**: paste your own Anthropic API key in Settings. After Codex finishes a turn, Deliberate Lite on Claude Opus 5.5 rewrites the reply you see. Without a key (or on error), you get Codex’s text unchanged.

## Quick start (Windows — live agent)

```powershell
npm install
npm test
npm run build
npm run electron
```

1. Install Codex once: `npm i -g @openai/codex`
2. Sign in once in a terminal: `codex login`  
   (or skip this and paste an API key in the app)
3. In Lalime onboarding → **Sign in with ChatGPT** (or API key)
4. Ask for help — replies stream from the live agent; tools are Guardian-gated

```powershell
# optional overrides
$env:LALIME_CODEX_BIN = "codex"
$env:LALIME_MODEL = "gpt-5.4"
# Hands.exe is built by npm run build on Windows (.NET 8) and used by default.
```

Full AORUS checklist: [docs/WINDOWS_INSTALL.md](docs/WINDOWS_INSTALL.md)

## Develop

```bash
npm run build && npm run electron   # standalone (loads dist/)
npm run dev                         # Vite + Electron (LALIME_DEV=1)
npm run dev:renderer                # browser UI only — sign-in prompts; no live Codex
```

Hot reload: [http://127.0.0.1:43123](http://127.0.0.1:43123)

## What is live vs mocked

| Piece | Status |
|---|---|
| Product chat / agent | **Live Codex** only (your credentials) |
| Guardian L1/L2 policy + tests | **Live** |
| Hands on Linux CI | **Mock / Node** (dev flag) |
| Hands.exe (screenshot, UIA, Recycle Bin) | **Default on Windows** — `npm run build` / `dist:win` produce it |
| Scripted chat fixtures | **Dev/CI only** via `LALIME_DEMO=1` — impossible in packaged builds |

## Windows installer

```powershell
pwsh scripts/build-windows-installer.ps1
# → release\Lalime-Setup-0.1.0.exe  (includes Hands.exe)
```

## Docs

- [docs/TESTING.md](docs/TESTING.md)
- [docs/WINDOWS_INSTALL.md](docs/WINDOWS_INSTALL.md)
- [docs/SUBMISSION_NOTES.md](docs/SUBMISSION_NOTES.md)
- [docs/JACKSON_TODO.md](docs/JACKSON_TODO.md)
- [docs/AI_DISCLOSURE.md](docs/AI_DISCLOSURE.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Scripts

| Command | Purpose |
|---|---|
| `npm run build && npm run electron` | Standalone desktop app |
| `npm run dev` | Vite + Electron |
| `npm test` | Guardian, agent loop, path + secret scans |
| `npm run fixture:headless` | Dev-only scripted Guardian fixture (`LALIME_DEMO=1`) |
| `npm run test:ui` | Playwright smoke (sign-in onboarding) |
| `npm run dist:win` | NSIS installer (on Windows) |

## License

MIT — [LICENSE](LICENSE).
