# Hands (Windows helper)

Hands is the unelevated Windows sidecar that performs:

- UI Automation (list/click/type by element name)
- Screenshots
- PowerShell text pre-checks and bounded command execution
- Per-command child process cleanup through Windows jobs

The PowerShell pre-check uses text patterns. It is not an AST parser or a security sandbox.
Each command runs in a separate worker. The worker stops after the command and terminates
its remaining child processes. This does not undo changes that the command already made.

The desktop bridge uses Electron's `shell.trashItem` for recycling. The Windows implementation
refuses permanent deletion when an item cannot be recycled. It does not use the native helper
for deletion. Restore recycled items manually through Windows. Automatic Undo is not available.

## This repo

- `hands/mock/` — TypeScript mock used on Linux CI and when `LALIME_DEMO=1` (dev fixtures only; never in packaged builds).
- On Windows, `Hands.exe` is the **default** backend (no env var). `npm run build` / `dist:win` require a .NET SDK and package the helper with its runtime. End users do not need to install .NET separately.
- See `docs/JACKSON_TODO.md` for Hands ownership notes.

## Protocol sketch (standard input and output)

JSON lines request/response:

```json
{"id":"1","method":"powershell.run","params":{"command":"Get-ComputerInfo","summary":"Read PC info"}}
{"id":"1","ok":true,"output":"..."}
```

Methods include `powershell.run`, `powershell.astCheck`, `uia.list`, `uia.click`, `uia.type`,
and `screen.capture`. The legacy `powershell.astCheck` name refers to the text pre-check.
Unsupported `journal.undo` requests fail explicitly. The bridge stops the helper process
to cancel native work.

## Native regression checks

After `npm run build:hands`, run `node scripts/qa-hands-native.mjs` on Windows. It uses
temporary paths and harmless PowerShell commands to test output, error correlation,
timeout, helper termination, and background child cleanup. It does not prove file recovery.
