# ADR 0008: KDP Story Studio

- Status: Accepted
- Date: 2026-10-29

## Context

AI Film Studio gains a module that turns a short brief into a complete, edited
fiction eBook plus everything needed to publish it manually on Amazon KDP. The
module must live inside the existing app and reuse its infrastructure without
disturbing the film workflows.

### Repository audit (2026-10-29)

| Area      | What exists                                                                                                                                                              | Consequence for KDP Story Studio                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Layout    | pnpm monorepo: `apps/api` (Fastify 5), `apps/web` (Next.js 16 App Router, React 19, client pages), `packages/{contracts,database,storage,providers,film-engine,tooling}` | Two new packages: `book-engine` (pure logic, usable in the browser) and `book-export` (EPUB/DOCX/ZIP, Node only) |
| Contracts | Zod 4 schemas shared by API and web; JSON Schema for providers via `z.toJSONSchema`                                                                                      | New `kdp.ts` contracts; generation outputs validated twice like the Story Room                                   |
| Database  | SQLite through better-sqlite3, WAL, numbered SQL migrations, repository classes                                                                                          | Migration `0011_kdp_story_studio.sql`, `Kdp*Repository` classes                                                  |
| Auth      | None. API binds to loopback only; single local user                                                                                                                      | Local-trust model kept (decision below); every KDP row carries `owner_id`                                        |
| Storage   | Files under `data/projects/<id>/`, SHA-256, magic-byte detection                                                                                                         | Book files under `data/books/<id>/` with the same rules                                                          |
| AI text   | `TextProvider` (OpenAI Responses, Claude Messages via SDK, Ollama) with one structured-JSON `generate`                                                                   | Extended with system prompts, model override, prose completion, cancellation, cache usage                        |
| Jobs      | Image/audio run as in-process promises and are failed on restart; video polls DB rows                                                                                    | New durable, checkpointed job runner for books (below)                                                           |
| UI        | Hand-written CSS design system in `globals.css`, lucide icons, `apiFetch`                                                                                                | Same tokens and components; `kdp.css` for module styles; TipTap for the editor                                   |
| Runtime   | Production build runs as LaunchAgent (`pnpm app:*`), web :3100, API :4100                                                                                                | Book jobs keep running without a browser tab                                                                     |

## Decisions

### Auth and ownership

The app stays local-trust: no login, loopback-only API. Every KDP table has an
`owner_id`. The API resolves the owner through one injectable function
(`resolveOwner`, default `local-owner`), and every repository query filters by it.
Tests inject a header-based resolver to prove that one owner cannot read or change
another owner's books. A future login only has to replace `resolveOwner`.

### Data model

Normalized where rows need identity, history or per-row status; consolidated JSON
where a document is edited as a whole:

- `kdp_author_profiles` (pen names; public identity only, never legal/tax data)
- `kdp_books` (brief JSON, status, stage, routing/budget overrides, approvals, soft delete)
- `kdp_concepts` (Stage A batches; one selected)
- `kdp_story_bibles` + `kdp_story_bible_versions` (Stage B/C document with stable
  entity IDs for characters, locations, timeline events, clues; every save is a version)
- `kdp_canon_changes` (every change to canon proposed by continuity inspection)
- `kdp_chapters` (Stage D card JSON, current text, summary, lock, approval, soft delete)
  - `kdp_chapter_revisions` (immutable text history with source `ai-draft`, `user-edit`, …)
- `kdp_editorial_reviews` + `kdp_editorial_issues` (severity, location, evidence,
  suggestion, optional replacement text, accept/reject status)
- `kdp_jobs` + `kdp_job_steps` (durable jobs and checkpoints) + `kdp_ai_runs`
  (every provider call: task, model, tokens, cost, duration, outcome)
- `kdp_artifacts` (cover concepts, metadata drafts and other generated documents)
- `kdp_cover_assets` (versioned uploads/composites with validation and provenance)
- `kdp_book_metadata` (listing JSON + approval), `kdp_publication_records`
- `kdp_provenance` (text / cover / interior images / translation)
- `kdp_exports` (files, validation results)
- `kdp_settings` (per-owner routing, prices, budget defaults)

Chapter text is stored as **manuscript markup**: paragraphs separated by a blank
line, `*italic*`, `**bold**`, a line `* * *` for a scene break, `\` escapes. The
editor converts it to and from a TipTap document; exporters parse it into blocks.
Markup keeps revision diffs readable and export deterministic.

### Generation pipeline

Never one call for a whole book. Stages are separate jobs, each a list of
checkpointed steps:

| Stage          | Job kind                          | Output                                                                                   | Default task route                           |
| -------------- | --------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| A Ideas        | `concepts`                        | 3 concepts                                                                               | idea → Claude                                |
| B Bible        | `bible`                           | story bible document                                                                     | architect → Claude                           |
| C Architecture | `architecture`                    | structure, truth timeline, clue map, red herrings, threat rules, relationship arc        | architect → Claude                           |
| D Outline      | `outline`                         | chapter cards with word targets from the planner                                         | architect → Claude                           |
| E Draft        | `draft`                           | chapters, scene by scene above ~3,000 words, then a coherence pass; expansion when short | writer → Claude                              |
| F Inspection   | inside `draft` after each chapter | summary, facts, character states, clue status, contradictions, canon changes             | inspector → OpenAI mini                      |
| Editorial      | `editorial`                       | developmental, continuity, line, copy, originality issues                                | reviewer → Claude; proofreader → OpenAI mini |
| Listing        | `metadata`, `cover-prompts`       | KDP listing, 3 cover concepts                                                            | metadata → OpenAI mini                       |

Context for each chapter is assembled by `book-engine`'s context builder with a
token budget: bible core, relevant characters, condensed outline, full cards for
the previous/current/next chapter, all prior summaries, the end of the previous
chapter, dependency excerpts, open clues and canon facts, style and content rules.
Claude receives the stable part as a cached system block.

### Durable job runner

`kdp_jobs` rows are the queue; the API process runs a worker loop. Properties:

- **No duplicates.** A partial unique index allows one active job per book lane
  (`write`, `utility`); a second click returns the existing job. Requests also
  carry an idempotency key.
- **Checkpoints.** A step's result and its database writes commit in one
  transaction; on resume completed steps are skipped, so a chapter is never
  written twice.
- **Restarts.** Jobs hold a lease; after a crash or restart, expired leases are
  re-queued and continue from the last checkpoint.
- **Cancel / resume / retry.** Cancellation aborts the in-flight request; transient
  errors (timeouts, 429, 5xx, overload) retry with backoff; permanent errors fail
  the step with a readable message and the job can be resumed.
- **Budgets.** Before every call the runner estimates its cost; if the book's
  spend plus the estimate exceeds the cap the job stops as `budget_stopped`.
  Actual cost is computed from returned usage and the editable price table.
- **Rate limits.** Per-provider concurrency limit and `retry-after` aware backoff.
- **Protection.** Locked or approved chapters are never overwritten; regeneration
  of a chapter requires it to be unlocked.

### Exports and validation

`book-export` builds EPUB 3 (with NCX for older readers), DOCX (`docx` library,
semantic heading styles, page breaks, linked TOC), Markdown, metadata JSON/HTML,
reports and a ZIP (`fflate`). EPUBs are checked by a built-in structural validator
and by EPUBCheck when available (`epubcheck` on PATH, installed with Homebrew).
Passing EPUBCheck is reported as such, never as "KDP approved". KPF is not
generated; the publishing assistant explains the Kindle Create route.

### Covers

The browser composes final covers: crop/position the artwork into a 1600 × 2560
frame, set the real title and pen name with web fonts, export RGB JPEG. Uploads,
drag-and-drop and clipboard paste all store a version; the server re-checks
format, pixel size, ratio, colour components and file size against the versioned
KDP rules in `book-engine`.

### KDP rules

`docs/kdp/kdp-rules-reference.md` is the researched source (with URLs and the
verification date); `book-engine/src/kdp-rules.ts` encodes the same version.
The UI shows the verification date so stale rules are visible.

## Consequences

- Film features keep their code paths; shared changes are additive (optional
  fields on the text-provider request, new routes, a new sidebar item).
- Long books keep generating while the LaunchAgent runs; with `pnpm dev` they
  continue only while that process runs, which the UI states.
- Real-provider behaviour is verified by the user (global no-live-keys rule);
  automated tests use mocked providers.
