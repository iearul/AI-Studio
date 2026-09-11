# AI Film Studio

A local-first, human-in-the-loop workspace for planning and producing AI-assisted
Reels and longer videos. Project metadata lives in SQLite, portable manifests live
beside project assets, and AI/storage providers are integrated behind replaceable
adapters.

## Prerequisites

- Node.js 22 or newer (Node 24 LTS is recommended)
- pnpm 9 or newer
- Ollama with `qwen3.5:9b-q4_K_M` for free local story generation
- ChatGPT access for manually creating character references and storyboard frames
- FFmpeg for later media-rendering phases

## Start locally

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm dev
```

Open the URL printed by `pnpm dev` (normally
<http://localhost:3000>, or <http://localhost:3001> when port 3000 is occupied).
The API listens only on <http://127.0.0.1:4100> by default.

All runtime data is excluded from Git:

```text
data/film-studio.sqlite  application database
data/projects/           portable project manifests and future assets
data/backups/            verified SQLite backups
cache/                   disposable working files
```

## Story planning workflow

Open a project and select **Build story plan**. The Story Room lets you choose
Local Ollama (private, no per-token charge), the separately billed OpenAI API, or
manual ChatGPT prompt export/import. Every path returns the same structured plan,
shows scene/shot/duration totals, and remains preview-only until you explicitly
import it. The accepted story, script, scenes, and shots are stored in SQLite and
mirrored into the portable `project.json` manifest.

Ollama runs as a background service after installation. The story adapter unloads
the model after a result so the 18 GB M3 Pro remains responsive.

## Visual Bible and continuity

The project workspace also provides character, location, and prop Bibles with
stable generated IDs, editable structured details, and local JPEG/PNG/WebP reference
uploads. Character cards provide detailed ChatGPT-ready reference-photo prompts.
Shot labels resolve only by exact name or stable code; unresolved labels are shown
instead of guessed. Each resolved shot receives a continuity prompt combining the
creative brief, cinematography, Bible facts, and reference paths.

## Storyboard generation and review

The Storyboard workspace keeps an immutable attempt history for every shot. Copy a
continuity-safe prompt into ChatGPT, create the image there, and import the resulting
JPEG/PNG/WebP frame. Each import records its prompt and reference snapshot; explicit
review selects exactly one approved image per shot. No local image model is started
by AI Film Studio, which avoids the memory pressure observed on the 18 GB M3 Pro.

## Quality checks

```bash
pnpm check
pnpm build
```

The implementation plan and decision register live in
[`AI_Film_Studio_Development_Blueprint.md`](AI_Film_Studio_Development_Blueprint.md).
Architectural decisions live under [`docs/architecture`](docs/architecture).
