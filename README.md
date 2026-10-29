# AI Studio

A local-first, human-in-the-loop workspace for planning and producing AI-assisted
Reels and longer videos. Project metadata lives in SQLite, portable manifests live
beside project assets, and AI/storage providers are integrated behind replaceable
adapters.

## Prerequisites

- Node.js 22 or newer (Node 24 LTS is recommended)
- pnpm 9 or newer
- Ollama with `qwen3.5:9b-q4_K_M` for free local story generation
- Optional OpenAI or Anthropic API key for paid automatic story generation
- Optional OpenAI or Gemini API key for paid image generation (ChatGPT works
  manually without one)
- Optional Kling or BytePlus Seedance API key for paid image-to-video generation
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

## Run in the background (macOS)

For everyday use, install the production build as a LaunchAgent once:

```bash
pnpm app:install
```

It builds the app, starts it at <http://localhost:3100>, starts it again at every
login, and restarts it if it stops. In Safari, open that address and choose
**File → Add to Dock** to open it like an app.

| Command              | Use                                                   |
| -------------------- | ----------------------------------------------------- |
| `pnpm app:update`    | Rebuild after code changes and restart                |
| `pnpm app:status`    | Show whether the API and web server are up            |
| `pnpm app:logs`      | Follow `~/Library/Logs/AI-Studio/app.log`             |
| `pnpm app:stop`      | Stop until next login, e.g. before running `pnpm dev` |
| `pnpm app:start`     | Start again                                           |
| `pnpm app:uninstall` | Remove the LaunchAgent                                |

The background app uses port 3100 so it does not clash with other local services
on port 3000.

All runtime data is excluded from Git:

```text
data/ai-studio.sqlite  application database
data/projects/           portable project manifests and future assets
data/backups/            verified SQLite backups
data/secrets/            private local OAuth tokens (mode 0600)
cache/                   disposable working files
```

## Story planning workflow

Open a project and select **Build story plan**. The Story Room lets you choose
Local Ollama (private, no per-token charge), the separately billed OpenAI or Claude
API, or manual ChatGPT prompt export/import. Every path returns the same structured
plan, shows scene/shot/duration totals, and remains preview-only until you
explicitly import it. The accepted story, script, scenes, and shots are stored in SQLite and
mirrored into the portable `project.json` manifest.

Ollama runs as a background service after installation. The story adapter unloads
the model after a result so the 18 GB M3 Pro remains responsive.

## Visual Bible and continuity

The project workspace also provides character, location, and prop Bibles with
stable generated IDs, editable structured details, and local JPEG/PNG/WebP reference
uploads. Every character, location, and prop card provides a detailed
reference-photo prompt for the selected view that can be generated with the OpenAI
or Gemini image API, sending that record's existing photos for consistency, or
copied into ChatGPT. The shot coverage list can start a storyboard frame directly.
Click any photo in the Bible, Storyboard, or Video workspace to view it full size.
Shot labels resolve only by exact name or stable code; unresolved labels are shown
instead of guessed. Each resolved shot receives a continuity prompt combining the
creative brief, cinematography, Bible facts, and reference paths.

## Storyboard generation and review

The Storyboard workspace keeps an immutable attempt history for every shot. Generate
a frame with OpenAI GPT Image or Google Gemini, which receive the shot's
continuity prompt and its Visual Bible reference photos, or copy the prompt into
ChatGPT and import the resulting JPEG/PNG/WebP frame. Paid generation asks for
confirmation with a cost estimate, runs in the background, and records the model,
quality, reference snapshot, and USD cost on the attempt. Explicit review selects
exactly one approved image per shot. No local image model is started by AI Film
Studio, which avoids the memory pressure observed on the 18 GB M3 Pro.

## Video production

Open **Video** after approving a storyboard image. Every shot recommends that exact
approved image as its first frame and supplies a motion-specific continuity prompt.
You can create the clip manually and import MP4/MOV/WebM, or choose Google Veo 3.1
(Fast, Standard, or Lite, sound included), Kling 3.0, Kling 2.5 Turbo, or BytePlus
Seedance 2.0 per shot. Veo uses the same `GEMINI_API_KEY` as Gemini images and makes
4-, 6-, or 8-second 16:9 or 9:16 clips; 1080p and 4K are 8 seconds only. Kling 2.5 Turbo is the cheaper
no-audio option and supports 5- or 10-second clips at 720p/1080p. Cloud submission
always shows the selected model, provider duration, resolution, audio choice, and
USD estimate in a native confirmation dialog; cancelling it makes no API request.
Cloud jobs run asynchronously, survive restarts, and successful results are streamed
into local project storage before provider links expire.

The API always attaches the approved storyboard image as `first_frame`. Kling 2.5
Turbo cannot receive separate character, location, or prop photos. Kling 3.0 accepts
additional continuity references only as pre-created Kling Element IDs, so the
current integration does not pretend that raw reference photos were sent.

## Sound production

Open **Sound** to give the narrator and each Bible character an ElevenLabs voice;
the choice is stored as a voice profile so a character sounds the same in every
scene. Each scene's narration is read by the narrator voice and its dialogue is
voiced in one request with every speaker's own voice, in the project language
(Bangla, English, or German). Dialogue lines written as `Name: line` are matched
to Bible characters by name or code; an unlabelled line belongs to the scene's
first character. Every shot can get generated sound effects and ambience at its
own length, and the project gets an instrumental background-music track sized to
the shot plan. Each take shows its estimated cost, runs in the background, plays
in the page, and is approved per scene, shot, or project. Audio files are stored in
the project folder, so they are included in backups and Google Drive sync. Joining
clips and audio into one finished video is the next phase.

To enable cloud video, add `KLING_API_KEY` and/or `SEEDANCE_API_KEY` to the ignored
`.env.local` file and restart the API. Seedance's documented restriction on direct
real-human face reference images is displayed in the workspace.

## KDP Story Studio

Open **KDP Story Studio** in the sidebar to write original fiction eBooks and
prepare everything for a manual upload to Amazon KDP. The pipeline never writes
a book in one request; each stage is a background job with saved checkpoints:

1. **Create New Story**: theme, genre, length, language and pen name, with
   optional voice, content and series settings.
2. **Story Blueprint**: three concepts, the story bible, the plot architecture
   and editable chapter cards (drag to reorder, lock, regenerate single cards).
3. **Draft**: chapters are written in order with the bible, outline, earlier
   summaries and established facts; each chapter is inspected for continuity.
   Locked and approved chapters are never changed.
4. **Chapter Editor**: rich-text editing with autosave, revisions and restore,
   AI help on a selected passage (you accept or reject every change), continuity
   warnings and the story bible beside the text.
5. **Editorial Review**, **Cover Studio**, **KDP Metadata** and **Export &
   Publish**: AI editorial passes, cover prompts and a typography composer for
   1600 × 2560 covers, an editable KDP listing with rule checks, AI-content
   disclosure answers, and EPUB/DOCX/ZIP exports validated with EPUBCheck.

Jobs run in the API process and continue without the browser; after a restart
they resume from their last checkpoint. Each book has an AI budget (default
$20, change it in **KDP Story Studio → Settings**); a job stops before a call
that would exceed it and can be resumed after raising the budget. Text models
are chosen per task in the same settings page; by default Claude writes and
reviews, OpenAI handles listing, cover prompts, proofreading and continuity
inspection.

EPUB validation uses EPUBCheck when it is installed (`brew install epubcheck`),
plus built-in structural and Kindle checks. Passing them does not mean KDP has
approved the file. Book files live in `data/books/`. The researched KDP rules
and their sources are in [`docs/kdp/kdp-rules-reference.md`](docs/kdp/kdp-rules-reference.md);
the design is in [`docs/architecture/0008-kdp-story-studio.md`](docs/architecture/0008-kdp-story-studio.md).
Before relying on the paid providers, follow
[`docs/kdp/real-provider-checklist.md`](docs/kdp/real-provider-checklist.md).

## Google Drive backup

AI Studio uses the least-privilege `drive.file` OAuth scope and creates this
visible hierarchy in your own Drive:

```text
OSPO/
├── AI-Film-Studio/            Film Studio
│   ├── projects/              manifests, reference images, storyboards and videos
│   └── backups/database/      verified SQLite snapshots of the whole app
└── KDP-Story-Studio/          KDP Story Studio
    └── books/<book id>/       book.json (all book data), covers and exports
```

A new KDP book gets its folder as soon as it is created (when Drive is
connected); **Sync projects, books & backup** uploads everything again.

Create a Google OAuth 2.0 **Web application** client, enable the Google Drive API,
and register this exact authorized redirect URI:

```text
http://127.0.0.1:4100/api/v1/integrations/google-drive/callback
```

Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the Git-ignored `.env.local`,
restart `pnpm dev`, then open **Settings → Connect Google Drive**. After Google
consent, choose **Sync projects, books & backup**. The refresh token is stored only in
`data/secrets/google-drive.json` with owner-only file permissions; it is never sent
to the browser or included in project manifests. **Backup now** always keeps the
verified local backup even when Drive is disconnected or unavailable.

If Google reports `redirect_uri_mismatch`, open **Settings**, copy the displayed
redirect URI, and add it unchanged to that same Web application's **Authorized
redirect URIs**. `localhost` and `127.0.0.1` are not interchangeable for this check.

## Quality checks

```bash
pnpm check
pnpm build
```

The implementation plan and decision register live in
[`Film_Studio_Development_Blueprint.md`](Film_Studio_Development_Blueprint.md).
Architectural decisions live under [`docs/architecture`](docs/architecture).
