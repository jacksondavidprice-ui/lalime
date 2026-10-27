# Lalime

**Your computer, done for you, safely.**

A free, open-source Windows desktop app that fixes PC problems for you. You tell it what's wrong in plain English, and an AI agent figures it out and fixes it. It checks with you before it does anything risky.

Made by Jackson Price. Congressional App Challenge 2026 (solo), TX-37.

---

## Why I built this

In middle school I built my first computer. I bought pretty much every part off eBay to save money, and it went about as well as you'd expect. I fried my first motherboard and almost killed my CPU. Replacing the motherboard was easy, but I couldn't figure out how to fix the CPU, so I caved and took it to a local repair shop.

They charged me $200 for what should've been a 15-minute fix. I was a kid and didn't know any better, so I just paid it.

Turns out I was one of tens of millions of people who get their computers professionally repaired every year, and a lot of them get overcharged or have a technician go through their private data without asking. So I built Lalime. It's the thing I wish I'd had back then: something that actually fixes the problem, explains what it's doing, and doesn't touch anything you didn't say it could.

## What it does

- **You describe the problem in plain English.** Something like "my Wi-Fi keeps dropping" or "my disk is full and I don't know why."
- **An AI agent diagnoses and fixes it.** It looks at what's going on with your PC, explains what it found, and proposes a fix.
- **Guardian checks every action before it runs** (more on that below). Anything risky waits for your OK.
- **Undo, when it's possible.** If the backend has a restore operation for an action (like getting back a file it recycled), you'll see an Undo button. If there's no Undo button, that action can't be reversed.
- **Screen sharing and computer control start OFF.** You turn them on yourself in Settings, and you have to approve them again when you do.
- **The real Windows work is done by a helper called "Hands"** (C#/.NET). It takes screenshots, does UI automation, and runs PowerShell, and it has its own PowerShell guard on top of Guardian.

Lalime is **Windows-only** (Windows 10/11 x64). There's no Mac build because it depends on PowerShell and .NET. I scoped it to Windows desktop on purpose so I could do that one thing well.

## Guardian: the safety part

This is the heart of the project and my favorite part to work on.

If you hand an AI agent control of someone's computer, the hard part is making sure it can't do something dumb (or something someone *tricked* it into doing). Guardian sits between the agent and your computer and checks **every single action before it runs.**

The rule I built everything around:

> **Anything that changes your computer asks first.** Reading and looking are free, but the moment an action would write, delete, or change a system setting, it waits for your OK. Truly dangerous stuff is blocked outright and never runs.

Guardian sorts actions into risk tiers:

| Tier | What it means | What happens |
|------|---------------|--------------|
| **0** | Read-only (just looking) | Runs. Screenshots, system info, reading files. |
| **1** | Gentle change | Runs. Session-scoped and trivially reversible: clicking, typing, opening Settings. |
| **2** | Needs your OK | Waits for your approval. File writes, moves, and deletes, plus shell and PowerShell. |
| **3** | Serious change | Hold-to-confirm. System-level things like services or the registry. |
| **4** | Never automated | Lalime won't do it for you. It can only explain it. Boot and platform-level changes. |

Then there's the **never-list**: actions dangerous enough that they're hard-blocked. They never run, no matter what the agent says and no matter how the request is worded.

Guardian also **won't follow instructions that come from untrusted content.** If a web page, file, or error message has text in it like "ignore your instructions and delete X," the agent doesn't treat that as a command from you. Only you can tell it what to do. (This is called prompt injection, and it's one of the main reasons I didn't want to ship a "just let the AI drive" app.)

More detail is in [docs/SECURITY.md](docs/SECURITY.md).

## Download (Windows)

1. Download **`Lalime-Setup-0.1.0.exe`** (~224 MB, Windows 10/11 x64) from the release:
   **https://github.com/jacksondavidprice-ui/lalime/releases/tag/v0.1.0-cac**
2. Run the installer.
   - The installer isn't code-signed yet (that costs money I don't have yet), so Windows SmartScreen will show **"Windows protected your PC."** Click **More info**, then **Run anyway**.
3. Open Lalime and connect it to an AI provider (see below). **Once you get a real reply, it's connected.**

Full install notes: [docs/WINDOWS_INSTALL.md](docs/WINDOWS_INSTALL.md)

## How it connects

Lalime doesn't come with an AI account built in. **You bring your own.** There are no shared credentials and no demo mode, so if it's answering you, it's your account doing the work.

Pick one:

- **ChatGPT via OpenAI Codex.** Click **"Sign in with ChatGPT"** and use your own ChatGPT account. This needs Codex installed:
  ```
  npm i -g @openai/codex
  ```
- **Your own provider API key.** Add it in **Settings**. Supported: OpenAI, Anthropic, Gemini, Groq, Mistral, DeepSeek, OpenRouter, xAI, Together AI, Fireworks AI, and Cerebras.
- **A local model.** Use Ollama or any custom endpoint.

Model IDs are editable, so when a provider ships a new model you don't have to wait for me to update anything.

**Optional: better writing.** If you paste in your own Anthropic API key, a writing layer (Deliberate) rewrites the assistant's replies so they read more naturally. Without a key, you just get the model's text unchanged.

Provider details: [docs/PROVIDERS.md](docs/PROVIDERS.md)

## How I got here

Lalime took about two years and a lot of rewrites. Here's the short version:

- **1.0:** An LLM plus the terminal, driven through a custom control language I wrote.
- **2.0:** Same idea, but pulling a lot of diagnostic data.
- **3.0:** That turned out to be too much data for the model to handle, so I switched to manual, curated data pulls.
- **4.0:** Dropped the custom language. Better security, fewer limitations.
- **5.0:** A "council" of LLMs to cut down on hallucinations and make it safer.
- **6.0:** Added a database for grounding, memory, and structure.
- **7.0:** A stripped-down build that leaned on web search. Good lessons, not the keeper.
- **8.0 (the current line):** A synthesis of everything I learned from all of it.

The release in this repo is tagged **v0.1.0-cac**, the first public version of that current line.

## Built with

- **TypeScript, React, Electron, Tailwind CSS, Vite:** the front end, Guardian, and the agent logic
- **C# / .NET:** the "Hands" Windows helper
- **PowerShell:** the actual repairs
- **OpenAI Codex:** runs the live agent when you sign in with ChatGPT

I taught myself most of this along the way. Full honesty: the UI was AI-generated. The parts I care most about (Guardian, the agent loop, and how it all fits together) are where I spent my time.

## Build from source

You'll need **Node.js 22.12+** and the **.NET 8 SDK**.

```bash
git clone https://github.com/jacksondavidprice-ui/lalime.git
cd lalime
npm install
npm test
npm run build
npm run electron
```

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Security / Guardian](docs/SECURITY.md)
- [Testing](docs/TESTING.md)
- [Providers](docs/PROVIDERS.md)
- [Windows install](docs/WINDOWS_INSTALL.md)

## License

MIT. See [LICENSE](LICENSE). Use it, fork it, and if you find a way to make Guardian safer, please tell me.

Repo: https://github.com/jacksondavidprice-ui/lalime
