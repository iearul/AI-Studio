# AI Film Studio

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
| `pnpm app:logs`      | Follow `~/Library/Logs/AI-Film-Studio/app.log`        |
| `pnpm app:stop`      | Stop until next login, e.g. before running `pnpm dev` |
| `pnpm app:start`     | Start again                                           |
| `pnpm app:uninstall` | Remove the LaunchAgent                                |

The background app uses port 3100 so it does not clash with other local services
on port 3000.

All runtime data is excluded from Git:

```text
data/film-studio.sqlite  application database
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
uploads. Character cards provide detailed reference-photo prompts that can be
generated with the OpenAI or Gemini image API, sending the character's existing
views for consistency, or copied into ChatGPT.
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
You can create the clip manually and import MP4/MOV/WebM, or choose Kling 3.0,
Kling 2.5 Turbo, or BytePlus Seedance 2.0 per shot. Kling 2.5 Turbo is the cheaper
no-audio option and supports 5- or 10-second clips at 720p/1080p. Cloud submission
always shows the selected model, provider duration, resolution, audio choice, and
USD estimate in a native confirmation dialog; cancelling it makes no API request.
Cloud jobs run asynchronously, survive restarts, and successful results are streamed
into local project storage before provider links expire.

The API always attaches the approved storyboard image as `first_frame`. Kling 2.5
Turbo cannot receive separate character, location, or prop photos. Kling 3.0 accepts
additional continuity references only as pre-created Kling Element IDs, so the
current integration does not pretend that raw reference photos were sent.

To enable cloud video, add `KLING_API_KEY` and/or `SEEDANCE_API_KEY` to the ignored
`.env.local` file and restart the API. Seedance's documented restriction on direct
real-human face reference images is displayed in the workspace.

## Google Drive backup

AI Film Studio uses the least-privilege `drive.file` OAuth scope and creates this
visible hierarchy in your own Drive:

```text
OSPO/
└── AI-Film-Studio/
    ├── projects/          manifests, reference images, storyboards and videos
    └── backups/database/  verified SQLite snapshots
```

Create a Google OAuth 2.0 **Web application** client, enable the Google Drive API,
and register this exact authorized redirect URI:

```text
http://127.0.0.1:4100/api/v1/integrations/google-drive/callback
```

Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the Git-ignored `.env.local`,
restart `pnpm dev`, then open **Settings → Connect Google Drive**. After Google
consent, choose **Sync projects & backup**. The refresh token is stored only in
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
[`AI_Film_Studio_Development_Blueprint.md`](AI_Film_Studio_Development_Blueprint.md).
Architectural decisions live under [`docs/architecture`](docs/architecture).
