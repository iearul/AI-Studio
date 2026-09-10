# AI Film Studio

A local-first, human-in-the-loop workspace for planning and producing AI-assisted
Reels and longer videos. Project metadata lives in SQLite, portable manifests live
beside project assets, and AI/storage providers are integrated behind replaceable
adapters.

## Prerequisites

- Node.js 22 or newer (Node 24 LTS is recommended)
- pnpm 9 or newer
- FFmpeg for later media-rendering phases

## Start locally

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm dev
```

Open <http://localhost:3000>. The API listens only on
<http://127.0.0.1:4100> by default.

All runtime data is excluded from Git:

```text
data/film-studio.sqlite  application database
data/projects/           portable project manifests and future assets
data/backups/            verified SQLite backups
cache/                   disposable working files
```

## Story planning workflow

Open a project and select **Build story plan**. The Story Room exports a
project-specific prompt for manual use in ChatGPT, validates the returned JSON,
shows scene/shot/duration totals, and imports the approved plan transactionally.
The resulting story, script, scenes, and shots are stored in SQLite and mirrored
into the portable `project.json` manifest.

## Visual Bible and continuity

The project workspace also provides character, location, and prop Bibles with
stable generated IDs, editable structured details, and local JPEG/PNG/WebP reference
uploads. Shot labels resolve only by exact name or stable code; unresolved labels are
shown instead of guessed. Each resolved shot receives a provider-neutral continuity
prompt combining the creative brief, cinematography, Bible facts, and reference
paths.

## Quality checks

```bash
pnpm check
pnpm build
```

The implementation plan and decision register live in
[`AI_Film_Studio_Development_Blueprint.md`](AI_Film_Studio_Development_Blueprint.md).
Architectural decisions live under [`docs/architecture`](docs/architecture).
