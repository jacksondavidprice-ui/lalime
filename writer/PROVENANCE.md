# What this folder is

A read-only extract from Jackson's private repo `jacksondavidprice-ui/aibutgood`, taken at commit
`50d5367a86f28d2b988c15ae083446447379745e` ("Save complete Deliberate system and Enterprise workspace"),
plus a few reference files from `jacksondavidprice-ui/LAPCRV6` (default branch) under `lime-inspiration/`.

The files keep their repo paths. Nothing was edited except removing transport wrappers.
No `.env` files, keys, tokens, author-preset corpora (they contain copyrighted excerpts),
lexical data (19 MB etymology.json), evidence JSON, or tests were copied.

Secret scan of this folder (sk-ant / sk- / AIza / ghp_ / xox / PEM patterns): no hits.

## Map

- `research/deliberate-writing/` – the Deliberate engine.
  - `prompts/writing-rules.txt` – the WRITING_DEFECT_RULES (assistant residue, generic framing, empty emphasis, redundancy, formulaic construction).
  - `prompts/writing-process.txt` – the long writer process guidance.
  - `prompts/reader-preferences.json` – curated reader-feedback examples given to editors (not the writer).
  - `src/experiment.mjs` – stage schemas + instructions (`read_document`, `verify_clarity`, `review_document`), `validate()`, `applyEdits()`.
  - `src/paragraph-workflow.mjs` – document_plan → paragraph_plan → write/revise loop.
  - `src/final-review.mjs` – extract_criteria → final_review → verify_final_revision.
  - `src/context-management.mjs` – fresh-call request serialization and context budgets.
  - `src/claude.mjs` – the Claude client wrapper (subscription CLI only; it deletes ANTHROPIC_API_KEY on purpose).
  - `scripts/writing-model-adapter.mjs` – audited provider adapter (hash-chained audit log).
- `apps/aibutamazing/` – how the live chat site embeds Deliberate.
  - `src/smart-provider.ts` – direct Anthropic Messages API call with controlled per-HTTP-status error text. Informed Lalime's earlier Anthropic-only writer client; the live path now reuses the user's selected provider via `writer/llm-client.ts`.
  - `prompts/anti-slop.md` – "Write direct prose" policy.
  - `docs/deliberate-main-chat.md`, `src/deliberate-chat.ts` – chat ↔ Deliberate bridge.
- `plugins/claude-clear-explanations/` – audience-aware explanation layer (finished product per repo README).
  - `output-styles/clear-explanations.md`, `guides/general/*.md` – the reader-first explanation rules.
  - `src/aiisms.mjs`, `src/padding.mjs`, `src/closer.mjs`, `src/prose.mjs` – deterministic, zero-latency checkers.
  - `src/prompts.mjs` – draft / rewrite / verify stage prompts.
- `docs/one-model-decision-20260930.md` – why the writer should get facts and a plan, not someone else's draft.
- `lime-inspiration/LAPCRV6/...` – safety and UX code worth porting ideas from (see DELIBERATE_INTEGRATION.md §8).

Licensing note: Jackson approved publishing the Deliberate writing prompts in this public repo
(Oct 2026). Only the four prompt files in `writer/prompts/` were copied; author-preset corpora
with copyrighted excerpts were never included.
