# Jackson TODO — your personal technical contributions

Contest rule: AI may support the project but must not be the entirety of the technical development. You need pieces you can explain to judges without reading a cheat sheet.

Work through these in order. Each is small and concrete.

## 1. Own the never-list (highest priority)

File: `guardian/src/never-list.ts`

- Read every `NEVER_RULES` entry.
- Rewrite at least **five** `plainEnglish` strings in your own words (grandparent-friendly).
- Add **one new rule** you care about (example: blocking `reg delete` of entire hives, or blocking changes to another user's Desktop).
- Run `npm run guardian:test` and keep it green.

Talking point for judges: “Guardian fails closed. These patterns never get an Allow button.”

## 2. Own the risk tiers

File: `guardian/src/tiers.ts`

- Memorize tiers 0–4 in one sentence each (comments at the top of the file).
- Change one default in `DEFAULT_ACTION_TIERS` only if you can defend it (e.g. should `ui_click` stay tier 1?).
- Update `docs/ARCHITECTURE.md` if you change a default.

## 3. Own the sync risk checker

File: `guardian/src/risk-checker.ts` — function `evaluateActionSync`

- Walk the pipeline on paper: never-list → untrusted content → default tier → ask-rules → decision kind.
- Add a short comment block in your own words above `evaluateActionSync` describing that order.
- Add **two** new cases to `guardian/tests/cases.jsonl` (one block, one ask) and make them pass.

## 4. PowerShell AST checker (Windows / C#)

Folder: `hands/` (real sidecar is still a stub)

- Sketch a C# method that uses `System.Management.Automation.Language.Parser` to reject `-EncodedCommand` and `Invoke-Expression` of downloaded strings.
- Put the sketch in `hands/src/PowerShellAstGuard.cs` (create it) with your name in the file header.
- Keep the TypeScript mock in sync: if the C# guard would block something, add a matching never-list pattern.

## 5. Written answers + video

- Edit the submission answers in your voice (inspiration, technical difficulty = building Guardian).
- Record the demo using `docs/TESTING.md` steps 2–3 as the hero moments.
- Cite real numbers from `npm test` only (do not invent block rates).

## What AI already scaffolded (do not claim as yours)

- Electron / React shell and visual design system
- Demo scenario scripts
- Codex app-server client wrapper
- Most of the unit test harness boilerplate

You should still be able to navigate those files and explain data flow: renderer → IPC → session → Guardian → Hands.
