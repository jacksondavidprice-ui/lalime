# Hands (Windows helper)

Hands is the unelevated Windows sidecar that performs:

- UI Automation (list/click/type by element name)
- Screenshots
- PowerShell AST pre-checks (anti-obfuscation)
- Recycle Bin moves and undo journaling

## This repo

- `hands/mock/` — TypeScript mock used on Linux CI and when `LALIME_DEMO=1` (dev fixtures only; never in packaged builds).
- On Windows, `Hands.exe` is the **default** backend (no env var). `npm run build` / `dist:win` build and package it when .NET 8 is available.
- See `docs/JACKSON_TODO.md` for Hands ownership notes.

## Protocol sketch (named pipe on Windows)

JSON lines request/response:

```json
{"id":"1","method":"powershell.run","params":{"command":"Get-ComputerInfo","summary":"Read PC info"}}
{"id":"1","ok":true,"output":"...","journalId":"j_123"}
```

Methods: `powershell.run`, `powershell.astCheck`, `uia.list`, `uia.click`, `uia.type`, `screen.capture`, `files.recycle`, `journal.undo`, `stop`.
