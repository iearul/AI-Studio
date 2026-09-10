# Personal AI Film Studio — Development Blueprint

## 1. Goal

Build a **local-only personal AI filmmaking application** for creating:

1. **Reels / Shorts**
   - Typical duration: 30–60 seconds
   - Main styles: mystery, horror, suspense, twist endings, unfinished/open endings, strange facts, legends, etc.
   - Goal: fast hooks, high retention, vertical format, frequent experimentation.

2. **Videos**
   - Typical duration initially: 3–10 minutes
   - Later target: 20–25 minutes
   - Main styles: history, mythology, legends, civilizations, biographies, historical mysteries, educational storytelling, etc.
   - Goal: stronger research, narrative structure, continuity, character/location consistency, cinematic storytelling.

The application is **not a SaaS** and will not be hosted publicly.

It will run on the local Mac and use:
- local AI models where practical,
- cloud AI APIs only where useful,
- Google Drive for project media/backups,
- Git only for source code and safe configuration templates.

---

# 2. Core Principles

## 2.1 Local-first

The application runs on:

```text
http://localhost:<port>
```

No public deployment is required.

No need for:
- user registration,
- authentication,
- subscriptions,
- payments,
- multi-tenancy,
- customer management,
- public analytics.

## 2.2 Human-in-the-loop

Do **not** make the application:

> Enter one sentence → automatically generate and publish a finished movie.

Instead:

```text
Idea
↓
Research / Story
↓
Review
↓
Script
↓
Review
↓
Characters & Locations
↓
Review
↓
Shot List
↓
Review
↓
Images
↓
Approve / Regenerate
↓
Video Clips
↓
Approve / Regenerate
↓
Audio
↓
Edit / Export
```

This reduces wasted API money and improves quality.

## 2.3 Provider-independent architecture

Never hard-code the whole application around one AI provider.

Use adapters/interfaces so providers can be replaced later.

Example:

```text
TextProvider
├── OpenAI
├── Local LLM
└── Future provider

ImageProvider
├── OpenAI Images
├── Local ComfyUI
├── Flux-based workflow
└── Future provider

VideoProvider
├── Local LTX
├── Local Wan
├── Kling
├── Seedance
├── Veo
└── Future provider

VoiceProvider
├── Local TTS
├── ElevenLabs
└── Future provider
```

Models and prices will change. The application should survive those changes.

---

# 3. Recommended High-Level Architecture

```text
┌────────────────────────────────────────────────────────┐
│                 PERSONAL AI FILM STUDIO                │
│                    Local Web App                       │
└─────────────────────────┬──────────────────────────────┘
                          │
                    Backend API
                          │
        ┌─────────────────┼───────────────────┐
        │                 │                   │
        ▼                 ▼                   ▼
   Project Engine     AI Orchestrator     Media Engine
        │                 │                   │
        │         ┌───────┼────────┐          │
        │         ▼       ▼        ▼          │
        │       Text    Image    Video        │
        │      Models   Models   Models       │
        │         │       │        │          │
        │         └───────┼────────┘          │
        │                 │                   │
        └─────────────────┼───────────────────┘
                          │
                    Project Storage
                          │
               ┌──────────┴──────────┐
               ▼                     ▼
        Local Database          Google Drive
        metadata/state          images/video/audio
```

---

# 4. Suggested Technology Stack

> **Implementation decision — 2026-09-10:** Accepted with the following concrete
> choices for the first production baseline. The repository uses a pnpm/TypeScript
> monorepo, Next.js App Router for `apps/web`, and a separate Fastify service for
> `apps/api`. SQLite remains the system of record. Database access is isolated in
> `packages/database` behind repositories and versioned SQL migrations so that a
> future PostgreSQL migration does not leak into domain or UI code. Long-running
> work begins with a persistent, single-machine job abstraction; BullMQ/Redis is
> deferred until generation concurrency or crash recovery proves it necessary.
> Local AI will integrate through the ComfyUI API. Paid cloud-video provider
> selection remains deliberately open until Phase 6, when price, regional
> availability, and credentials can be evaluated with an explicit user decision.
> See `docs/architecture/0001-foundation.md` for the rationale and boundaries.

Use whatever stack is most comfortable, but a practical setup is:

## Frontend

```text
Next.js
React
TypeScript
Tailwind CSS
```

Alternative:

```text
Vue / Nuxt
```

## Backend

Either:

```text
Next.js server/API routes
```

for a small first version,

or:

```text
Node.js
NestJS / Fastify / Express
```

for a cleaner long-term backend.

## Database

Start with:

```text
SQLite
```

Reason:
- local-only application,
- zero database server setup,
- portable,
- easy backup,
- adequate for one-person usage.

Later PostgreSQL can be used if necessary, but it is probably unnecessary initially.

## Queue

For long-running tasks:

```text
BullMQ + Redis
```

or initially a simpler local job runner.

Long-term jobs include:
- image generation,
- video generation,
- audio generation,
- upscaling,
- FFmpeg rendering,
- Google Drive upload.

## Local AI

Recommended integration layer:

```text
ComfyUI
```

Possible video engines:
- LTX
- Wan
- other compatible local workflows

## Media Processing

```text
FFmpeg
```

Use it for:
- joining clips,
- extracting frames,
- converting formats,
- resizing,
- audio mixing,
- subtitles,
- proxy generation,
- final export.

## Storage

Use both:

```text
Local cache
+
Google Drive
```

---

# 5. Application Home Screen

Keep the main UI simple.

```text
┌──────────────────────────────────────────────┐
│              AI FILM STUDIO                 │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────┐   ┌────────────────┐     │
│  │     REELS      │   │     VIDEOS     │     │
│  │                │   │                │     │
│  │ Mystery        │   │ History        │     │
│  │ Horror         │   │ Mythology      │     │
│  │ Suspense       │   │ Legends        │     │
│  │ Twist          │   │ Biography      │     │
│  │ Open ending    │   │ Educational    │     │
│  └────────────────┘   └────────────────┘     │
│                                              │
│              [+ New Project]                 │
└──────────────────────────────────────────────┘
```

The categories are **presets**, not hard restrictions.

A project can always use a custom topic.

---

# 6. Project Creation

When creating a project, ask for:

```text
Project type:
○ Reel
○ Video

Topic:
________________________

Language:
○ Bangla
○ English
○ German
○ Other

Target duration:
[ 60 seconds ]

Aspect ratio:
○ 9:16
○ 16:9
○ 1:1

Style:
○ Mystery
○ Horror
○ Historical
○ Mythological
○ Documentary
○ Cinematic
○ Custom

Narration:
○ Narrator
○ Character dialogue
○ Both
○ None
```

Optional:

```text
Target audience
Tone
Age rating
Country / culture
Visual style
Desired ending
```

---

# 7. Reel Workflow

Reels require a special storytelling engine.

## Recommended structure

For a 45–60 second Reel:

```text
0–3 sec       Hook
3–10 sec      Setup
10–30 sec     Escalation
30–45 sec     Reveal / tension
45–60 sec     Twist / cliffhanger / open ending
```

Example templates:

### Mystery

```text
Hook
↓
Something impossible happens
↓
Character investigates
↓
Unexpected evidence
↓
Final disturbing clue
↓
Cut before full explanation
```

### Horror

```text
Normal situation
↓
Small abnormal detail
↓
Character notices it
↓
Danger increases
↓
Apparent explanation
↓
Final twist
```

### Unfinished Ending

The ending must intentionally create:

```text
"What happened next?"
```

without feeling like the video simply stopped randomly.

---

# 8. Long Video Workflow

Long videos need a different system.

Example 20-minute structure:

```text
Cold open / hook        0:00–0:45
Context                 0:45–3:00
Main story begins       3:00–6:00
Development             6:00–12:00
Conflict / discovery   12:00–17:00
Climax                 17:00–19:00
Conclusion             19:00–20:00
```

Do not create a 20-minute video as one AI generation.

Represent it as:

```text
Project
↓
Chapters
↓
Scenes
↓
Shots
↓
Individual clips
```

Example:

```text
20-minute video
↓
6 chapters
↓
18 scenes
↓
160 shots
```

---

# 9. Research Layer for History and Mythology

This is extremely important.

The application should separate:

```text
Verified historical information
Traditional account
Legend
Mythology
Disputed interpretation
Creative dramatization
```

Never let the script generator silently convert a myth or uncertain historical claim into a confirmed fact.

Suggested research object:

```json
{
  "claim": "Example historical claim",
  "classification": "verified | disputed | legend | myth | dramatization",
  "notes": "...",
  "sources": []
}
```

Later the script engine can use these classifications.

Example narration:

```text
"According to later tradition..."
```

instead of:

```text
"This definitely happened..."
```

when evidence is uncertain.

---

# 10. Story Engine

Store the story separately from the screenplay.

Suggested fields:

```text
Title
Logline
Genre
Theme
Tone
Main conflict
Main character
Supporting characters
Beginning
Middle
Climax
Ending
Audience emotion
```

For Reels also store:

```text
Hook
Twist
Cliffhanger
Retention moments
```

---

# 11. Screenplay Engine

Convert story → screenplay.

Each scene contains:

```text
Scene number
Location
Time of day
Characters
Action
Narration
Dialogue
Estimated duration
Emotional purpose
```

Example:

```text
SCENE 03
Location: abandoned railway station
Time: night
Duration: 18 sec

Character:
Rahim

Action:
Rahim notices a light inside a train that has
not operated for twenty years.

Narration:
...

Dialogue:
...
```

---

# 12. Character Bible

Character consistency is one of the most important features.

Each character should have a persistent record.

```text
Character ID
Name
Age
Gender
Ethnicity / cultural appearance
Face description
Hair
Eyes
Skin
Height
Body type
Default clothes
Alternative clothes
Accessories
Personality
Voice
Speech style
Reference images
```

Example:

```text
CHAR_RAHIM_001

Name: Rahim
Age: 34
Hair: short black hair
Beard: short trimmed beard
Build: average
Default clothing:
- beige shirt
- dark trousers
- brown leather watch
```

## Character reference images

Store:

```text
front.png
three-quarter.png
profile.png
full-body.png
neutral.png
happy.png
angry.png
sad.png
```

These become source references for future generations.

Do not expect independent text prompts to reproduce the exact same person.

---

# 13. Location Bible

Locations should also be persistent.

Example:

```text
LOC_VILLAGE_HOME_01

Country: Bangladesh
Type: rural family house
Wall material: ...
Floor: ...
Furniture: ...
Lighting: ...
Main colors: ...
Nearby environment: ...
Time-period details: ...
```

Store reference images:

```text
exterior-day.png
exterior-night.png
living-room.png
kitchen.png
bedroom.png
```

This helps maintain visual continuity.

---

# 14. Props / Objects Bible

For recurring objects, create persistent references.

Examples:

```text
PROP_OLD_BOOK
PROP_MAGIC_RING
PROP_SWORD_01
PROP_TRAIN_TICKET
PROP_ANCIENT_MAP
```

This becomes especially useful for mythology and mystery stories.

---

# 15. Shot Engine

Every scene becomes multiple shots.

Suggested shot object:

```json
{
  "id": "SHOT_001",
  "sceneId": "SCENE_001",
  "duration": 5,
  "characters": ["CHAR_RAHIM_001"],
  "location": "LOC_STATION_001",
  "shotType": "medium close-up",
  "cameraAngle": "eye level",
  "lens": "50mm",
  "cameraMovement": "slow dolly in",
  "action": "Rahim slowly turns toward the sound",
  "lighting": "dim blue moonlight",
  "emotion": "fear",
  "status": "draft"
}
```

---

# 16. Cinematography Vocabulary

The application should understand common shot types.

## Framing

```text
Extreme Wide Shot
Wide Shot
Medium Wide Shot
Medium Shot
Medium Close-Up
Close-Up
Extreme Close-Up
Over-the-Shoulder
POV
Insert Shot
Reaction Shot
```

## Camera angle

```text
Eye Level
Low Angle
High Angle
Dutch Angle
Bird's-Eye View
Ground Level
```

## Camera movement

```text
Static
Pan
Tilt
Dolly In
Dolly Out
Tracking
Orbit
Crane
Handheld
Slow Push-In
Rack Focus
```

## Lens vocabulary

```text
24mm
35mm
50mm
85mm
Telephoto
Wide-angle
Macro
Shallow depth of field
Deep focus
```

---

# 17. Prompt Builder

Do not manually rewrite all character details for every shot.

Generate prompts automatically from structured objects.

Concept:

```text
Character Bible
+
Location Bible
+
Shot Information
+
Camera Information
+
Lighting
+
Visual Style
+
Action
+
Model-specific instructions
=
Final Prompt
```

Example:

```text
Rahim, matching the supplied character reference,
stands inside the abandoned railway station.

Medium close-up, eye-level, 50mm lens,
slow cinematic dolly-in.

He slowly turns toward a metallic sound behind him.

Cold moonlight enters through broken windows.
Subtle fog in the background.
Natural realistic skin texture.
Cinematic realistic photography.

Maintain the exact facial identity, hairstyle,
clothing and body proportions from the character reference.
```

---

# 18. AI Provider Layer

Define provider interfaces.

## Text

```typescript
interface TextProvider {
  generate(request: TextRequest): Promise<TextResult>;
}
```

## Image

```typescript
interface ImageProvider {
  generate(request: ImageRequest): Promise<ImageResult>;
}
```

## Video

```typescript
interface VideoProvider {
  generate(request: VideoRequest): Promise<VideoJob>;
  getStatus(jobId: string): Promise<VideoStatus>;
}
```

## Voice

```typescript
interface VoiceProvider {
  generate(request: VoiceRequest): Promise<AudioResult>;
}
```

---

# 19. Local vs Cloud Generation

Every video shot should allow choosing a provider.

Example UI:

```text
SHOT 017

Character: Rahim
Duration: 5 sec

Generation Mode

○ Local — LTX
○ Local — Wan
○ Cloud — Kling
○ Cloud — Seedance
○ Cloud — Veo
○ Auto
```

## Auto mode

Later implement:

```text
Try local generation
↓
User reviews
↓
If rejected
↓
Try another local generation
↓
If still poor
↓
Suggest cheap cloud provider
↓
Premium provider only when necessary
```

Do not automatically spend cloud money without explicit permission.

---

# 20. Image-First Workflow

For most shots:

```text
Shot description
↓
Generate still image
↓
Review
↓
Regenerate cheaply if wrong
↓
Approve image
↓
Image-to-video
```

This is preferable to blindly generating expensive video.

Reasons:
- better character consistency,
- easier composition control,
- cheaper retries,
- clearer art direction.

---

# 21. Local AI Setup

Primary recommendation:

```text
ComfyUI
```

The Film Studio communicates with ComfyUI through its local API.

Architecture:

```text
Film Studio
↓
Local backend
↓
ComfyUI API
↓
Workflow
↓
LTX / Wan / other model
↓
Generated file
```

The exact model can change without changing the Film Studio UI.

---

# 22. Cloud AI API Setup

Keep API credentials in environment variables.

Example:

```text
OPENAI_API_KEY=
KLING_API_KEY=
SEEDANCE_API_KEY=
ELEVENLABS_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Never commit real keys to Git.

Add:

```text
.env
.env.local
secrets/
```

to `.gitignore`.

Commit only:

```text
.env.example
```

with blank values.

---

# 23. ChatGPT Subscription vs OpenAI API

A ChatGPT subscription is separate from API billing.

Initially the Film Studio can work in a **manual ChatGPT mode**.

Example:

```text
Film Studio
↓
Export "Story Request"
↓
Paste into ChatGPT
↓
ChatGPT produces structured JSON
↓
Import JSON into Film Studio
```

This lets you use your existing ChatGPT subscription while developing the workflow.

Later:

```text
Film Studio
↓
OpenAI API
↓
Automatic story/script/shot generation
```

API integration can therefore be introduced only when automation becomes worth paying for.

---

# 24. Google Drive Storage

Google Drive can be used for project assets.

Recommended hierarchy:

```text
AI-Film-Studio/
│
├── projects/
│   ├── project-001/
│   │   ├── project.json
│   │   ├── characters/
│   │   ├── locations/
│   │   ├── storyboards/
│   │   ├── images/
│   │   ├── videos/
│   │   ├── audio/
│   │   ├── subtitles/
│   │   └── exports/
│   │
│   └── project-002/
│
├── shared-assets/
│   ├── characters/
│   ├── music/
│   ├── sound-effects/
│   └── textures/
│
└── backups/
```

Do not depend exclusively on local disk storage.

---

# 25. Local Cache

AI files can be large.

Use a cache such as:

```text
~/AI-Film-Studio/cache/
```

Example:

```text
cache/
├── downloads/
├── generated/
├── proxies/
├── thumbnails/
└── temporary/
```

Once a file is safely uploaded to Drive, old cache files can be deleted.

---

# 26. Database Design

Suggested initial SQLite tables:

```text
projects
research_items
stories
scripts
chapters
scenes
shots
characters
character_references
locations
location_references
props
assets
generation_jobs
generation_attempts
providers
voices
audio_tracks
exports
settings
```

Important: separate a **shot** from a **generation attempt**.

Example:

```text
SHOT_07
├── Attempt 1 ❌
├── Attempt 2 ❌
├── Attempt 3 ✅ selected
└── Attempt 4
```

Never overwrite old generations automatically.

---

# 27. Project File

In addition to SQLite, export each project into a portable file:

```text
project.json
```

This acts as a project manifest.

Example:

```json
{
  "projectVersion": 1,
  "id": "project-001",
  "title": "The Last Train",
  "type": "reel",
  "characters": [],
  "locations": [],
  "scenes": [],
  "shots": [],
  "assets": []
}
```

This makes migrations and recovery easier.

---

# 28. Generation History

Every AI generation should record:

```text
provider
model
prompt
negative prompt
references
seed if supported
settings
generation time
cost if cloud
output
status
created time
```

This lets you reproduce or understand successful shots later.

---

# 29. Cost Tracking

Even for a personal app, track cloud cost.

Example:

```text
PROJECT COST

Text               €0.08
Images              €0.85
Video              €5.60
Voice               €0.22
Music               €0.00
--------------------------
Total               €6.75
```

Before cloud video generation:

```text
Kling
5 seconds
Estimated cost: €X.XX

[Generate]
```

The application should never hide spending.

---

# 30. Voice System

Each recurring character can have a voice profile.

```text
VOICE_RAHIM

Provider
Voice ID
Language
Accent
Pitch
Speed
Emotion
```

Narrator should also be stored as a profile.

This helps keep voices consistent between scenes.

---

# 31. Audio System

Audio categories:

```text
Narration
Dialogue
Background music
Ambience
Sound effects
Transitions
Impact sounds
```

Keep each type on a separate track.

Example:

```text
Track 1 — Dialogue
Track 2 — Narration
Track 3 — Ambience
Track 4 — SFX
Track 5 — Music
```

---

# 32. Subtitles

Generate subtitle data from narration/dialogue.

Preferred internal format:

```text
WebVTT or SRT
```

Allow:
- Bangla,
- English,
- bilingual subtitles.

For Shorts, optionally create large social-style captions later.

---

# 33. Editing Strategy

Do not build a full Premiere/DaVinci replacement initially.

Phase 1:

```text
Film Studio generates assets
↓
Export clips/audio/subtitles
↓
Manual edit in DaVinci Resolve / CapCut
```

Later:

```text
Film Studio
↓
Basic timeline
↓
FFmpeg
↓
Draft MP4
```

Then manually polish if necessary.

---

# 34. Automatic Draft Editing

Eventually allow:

```text
[Create Draft]
```

The application uses shot durations to build:

```text
Shot 1   0:00–0:05
Shot 2   0:05–0:09
Shot 3   0:09–0:14
...
```

FFmpeg generates a review copy.

Do not treat this as the final creative edit.

---

# 35. Reel-Specific Features

Eventually add:

```text
Hook score
First-frame preview
Caption generator
Title suggestions
Description suggestions
Hashtag suggestions
Thumbnail ideas
Retention checkpoints
Loop ending
Cliffhanger ending
```

The application does not need to upload directly to YouTube initially.

---

# 36. Video-Specific Features

For long videos:

```text
Chapter management
Research notes
Fact classification
Timeline
Map references
Character history
Source notes
Narration pacing
B-roll planning
Scene continuity
```

---

# 37. Suggested UI Pages

```text
/dashboard
/projects
/projects/:id

/projects/:id/research
/projects/:id/story
/projects/:id/script
/projects/:id/characters
/projects/:id/locations
/projects/:id/scenes
/projects/:id/shots
/projects/:id/storyboard
/projects/:id/audio
/projects/:id/assets
/projects/:id/export
/projects/:id/costs

/settings/providers
/settings/local-ai
/settings/google-drive
/settings/storage
/settings/backup
```

---

# 38. Shot Workspace UI

A shot page might look like:

```text
┌────────────────────────────────────────────────────┐
│ SHOT 017                                           │
├────────────────────────────────────────────────────┤
│                                                    │
│ Scene: Station                                     │
│ Character: Rahim                                   │
│ Location: Old Station                              │
│ Duration: 5 sec                                    │
│                                                    │
│ [Reference Images]                                 │
│                                                    │
│ Action                                             │
│ Rahim slowly looks behind him...                   │
│                                                    │
│ Camera                                             │
│ Medium close-up / 50mm / slow dolly in             │
│                                                    │
│ Prompt                                             │
│ [editable prompt...]                               │
│                                                    │
│ Provider                                           │
│ ○ Local LTX                                        │
│ ○ Kling                                            │
│ ○ Seedance                                         │
│                                                    │
│ [Generate Image]                                   │
│ [Generate Video]                                   │
│                                                    │
├────────────────────────────────────────────────────┤
│ Attempts                                           │
│ #1 ❌   #2 ❌   #3 ✅ Selected                     │
└────────────────────────────────────────────────────┘
```

---

# 39. Background Jobs

Generation should not block normal HTTP requests.

Example:

```text
POST /shots/17/generate-video
↓
Create job
↓
Return job ID
↓
Worker generates video
↓
UI checks progress
↓
Upload result to Drive
↓
Update database
```

Possible statuses:

```text
queued
preparing
generating
downloading
uploading
completed
failed
cancelled
```

---

# 40. Error Handling

Store full error details.

Examples:

```text
provider timeout
insufficient credits
local model out of memory
Google Drive upload failed
invalid reference image
generation rejected
FFmpeg failed
```

Never delete a working project because one generation job failed.

---

# 41. Portability — Moving to a New Laptop

## Important answer

If only the **source code** is stored in Git, then:

```text
git clone
```

will restore the application code, but **not automatically restore everything else**.

The following are normally NOT in Git:

```text
API keys
SQLite database
generated videos
images
audio
Google OAuth credentials
ComfyUI models
local AI model weights
cache
personal settings
```

Therefore, design portability from the beginning.

---

# 42. Portable Architecture

Separate the system into four categories.

## A. Source Code — Git

```text
GitHub / Git repository
```

Contains:

```text
application code
database migrations/schema
ComfyUI workflow definitions
configuration templates
Docker files
installation scripts
README
```

Does NOT contain:

```text
API secrets
large AI models
private media
database backups
```

---

## B. Project Assets — Google Drive

Contains:

```text
images
video clips
audio
storyboards
exports
project manifests
character references
location references
```

When changing computer, the app reconnects to Drive.

---

## C. Application Database — Backed Up

The SQLite file contains important metadata.

Example:

```text
data/film-studio.sqlite
```

Automatically back it up to:

```text
Google Drive/AI-Film-Studio/backups/database/
```

Example:

```text
film-studio-2026-09-10.sqlite
film-studio-2026-09-11.sqlite
...
```

Recommended:

```text
Daily automatic backup
+
Backup when app closes cleanly
+
Manual "Backup Now" button
```

Keep multiple versions.

---

## D. AI Models — Re-downloadable

Do not upload 10–100 GB model files to Git.

Instead store a manifest:

```yaml
models:
  - id: ltx-example
    source: ...
    version: ...
  - id: wan-example
    source: ...
    version: ...
```

On a new computer:

```text
npm run setup-models
```

or another setup script downloads/install models again.

---

# 43. Secrets Migration

Never store API keys in Git.

Create:

```text
.env.example
```

Example:

```text
OPENAI_API_KEY=
KLING_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

On migration either:

1. enter keys again,
2. restore an encrypted secrets backup,
3. use macOS Keychain.

For a personal Mac application, **macOS Keychain** is preferable long-term.

---

# 44. One-Command Restore Goal

Eventually aim for:

```bash
git clone <repository>
cd ai-film-studio
./setup.sh
```

The setup process should:

```text
1. Check Node
2. Install dependencies
3. Check/install FFmpeg
4. Configure local folders
5. Connect Google Drive
6. Download latest database backup
7. Run migrations
8. Configure ComfyUI
9. Detect missing AI models
10. Offer to download models
11. Start the application
```

Then:

```text
npm run dev
```

Your projects appear again.

This makes moving to another Mac almost painless.

---

# 45. Docker

Docker is useful for application services such as:

```text
backend
Redis
optional database
supporting services
```

However, local GPU/Apple Metal AI tooling may be easier to run natively on macOS.

A reasonable architecture:

```text
Docker:
- application services
- Redis

Native macOS:
- ComfyUI
- local AI models
- FFmpeg
- DaVinci Resolve
```

Do not force every component into Docker if native Apple Silicon acceleration works better outside it.

---

# 46. Repository Structure

Example:

```text
ai-film-studio/
│
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── ai/
│   │   ├── text/
│   │   ├── image/
│   │   ├── video/
│   │   └── voice/
│   │
│   ├── film-engine/
│   ├── storage/
│   ├── database/
│   └── shared/
│
├── comfyui/
│   ├── workflows/
│   └── model-manifest.yaml
│
├── scripts/
│   ├── setup.sh
│   ├── backup.sh
│   └── restore.sh
│
├── data/
│   └── .gitkeep
│
├── docs/
│
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
└── README.md
```

---

# 47. Recommended `.gitignore`

At minimum:

```gitignore
.env
.env.local
.env.*.local

node_modules/

data/*.sqlite
data/*.db

cache/
tmp/
generated/

models/
checkpoints/

*.mp4
*.mov
*.wav
*.mp3

secrets/
credentials/
```

Be careful: character/project JSON may contain private information or copyrighted/source material. Decide whether those belong in Git.

Recommended default:

```text
Git = application source code only.
Drive = personal project content.
```

---

# 48. Backup Strategy

Use the **3-layer approach**.

```text
Git
→ code

Google Drive
→ project assets + database backups

Local disk
→ active working cache
```

Optional future safety:

```text
External SSD backup
```

For irreplaceable personal work, do not rely on only one copy.

---

# 49. Machine Migration Checklist

When replacing the Mac:

```text
1. Push latest source code to Git.
2. Run "Backup Now".
3. Confirm latest SQLite backup exists in Google Drive.
4. Confirm project assets are uploaded.
5. On new Mac, clone Git repository.
6. Run setup script.
7. Reconnect Google account.
8. Restore latest database.
9. Add/recover API keys.
10. Re-download local AI models.
11. Start ComfyUI.
12. Start Film Studio.
13. Verify old projects.
```

After this, the new machine should contain the same logical Film Studio.

---

# 50. Hardware Upgrade Benefit

The architecture should detect available hardware.

Example:

```text
Current:
M3 Pro
18 GB unified memory

Future:
M-series Max / Ultra
larger unified memory
or dedicated NVIDIA workstation
```

The application itself should not care.

Only the local AI provider configuration changes.

Example:

```text
LOCAL_VIDEO_PROVIDER=LTX
```

later becomes:

```text
LOCAL_VIDEO_PROVIDER=WAN_LARGE
```

The project data, shots, prompts, Drive files and UI remain unchanged.

---

# 51. Development Phases

Do not build everything at once.

## Phase 1 — Project Manager

> **Implementation status — 2026-09-10:** The local Phase 1 success criterion is
> complete. The application creates, persists, closes/reopens, manifests, backs
> up, verifies, and restores projects. Settings includes Google Drive credential
> readiness and the intended remote folder, but authenticated Drive OAuth/upload
> is tracked separately as Phase 1B because it requires user-supplied Google OAuth
> credentials for a real acceptance test. No remote-backup claim is made yet.

Build:

```text
Reels / Videos
Create project
Project list
SQLite
Settings
Basic Google Drive connection
```

Success criterion:

> Can create, close, reopen and back up projects.

---

## Phase 2 — Story System

> **Implementation status — 2026-09-10:** Complete. A project-specific manual
> ChatGPT request can be exported, its JSON response is validated without being
> saved, and the filmmaker sees scene, shot, and duration totals before import.
> An accepted plan is written transactionally as a versioned story and script
> with ordered scenes and globally identified shots, then synchronized into the
> portable project manifest. Re-import replaces the prior scene/shot hierarchy
> only after an explicit UI confirmation; generation history remains a Phase 4+
> concern and will protect generated assets independently.

Build:

```text
Idea
Story
Script
Scenes
Shot list
Manual ChatGPT import/export
```

Success criterion:

> Can convert one Reel idea into a complete structured shot plan.

---

## Phase 3 — Character & Location Bible

> **Implementation status — 2026-09-10:** Complete. Characters, locations, and
> recurring props have stable generated codes, structured editable records, and
> project-local reference images. Shot labels resolve deterministically by exact
> case-insensitive name or stable code; unresolved labels are surfaced rather than
> guessed. Each shot receives a provider-neutral continuity prompt containing the
> resolved Bible facts and every available reference path. See
> `docs/architecture/0002-visual-bible.md`.

Build:

```text
Characters
Character references
Locations
Location references
Props
Prompt builder
```

Success criterion:

> Every shot automatically inherits correct references.

---

## Phase 4 — Image Generation

> **Implementation status — 2026-09-10:** Phase 4A is complete. The application
> now has a provider-neutral image interface, a loopback-only ComfyUI adapter for
> API-format workflows, persistent crash-recoverable jobs, immutable attempt and
> asset history, a manual-import fallback, and explicit per-shot approve/reject
> review with exactly one selected frame. The installed ComfyUI endpoint was
> checked and is currently offline/unconfigured, so a live local-model render is
> not claimed. Phase 4B tracks selection of an installed model/workflow plus a real
> render acceptance test; Google Drive asset upload remains blocked by the Phase 1B
> OAuth credential milestone. See `docs/architecture/0003-image-generation.md`.

Build:

```text
Image provider interface
Local ComfyUI image workflow
Optional cloud image provider
Generation history
Approve / reject
Google Drive upload
```

Success criterion:

> Can create and approve one storyboard image per shot.

---

## Phase 5 — Local Video

Build:

```text
ComfyUI API
LTX workflow
Optional Wan workflow
Image-to-video
Job progress
Generation attempts
```

Success criterion:

> Approved storyboard image becomes a local AI video.

---

## Phase 6 — Cloud Video

Build:

```text
Video provider abstraction
One inexpensive cloud provider
Cost estimation
Explicit confirmation
Download
Drive upload
```

Success criterion:

> A local shot can be switched to cloud generation without changing project structure.

---

## Phase 7 — Audio

Build:

```text
Narration
Character voices
Voice profiles
Sound effects
Music assets
Subtitles
```

---

## Phase 8 — Draft Renderer

Build:

```text
Timeline
FFmpeg
Clip assembly
Audio mix
Subtitle support
Draft export
```

---

## Phase 9 — Long Video Features

After multiple successful Shorts:

```text
chapters
research database
fact classification
large shot lists
batch operations
continuity checker
asset reuse
B-roll planner
```

---

# 52. First MVP

Do not begin with the 20-minute-film system.

Build enough to create:

> **One 45–60 second Reel**

The first MVP needs only:

```text
✅ Create Reel project
✅ Story
✅ Script
✅ Characters
✅ Scene list
✅ Shot list
✅ Character references
✅ Image generation
✅ Local video generation
✅ Optional cloud video
✅ Google Drive upload
✅ Export clips for DaVinci
```

If that works well, make 3–5 Shorts.

Then improve the workflow based on real problems.

---

# 53. Suggested First Test Film

Choose something deliberately small.

Example:

```text
Genre:
Mystery / Horror

Duration:
45 seconds

Characters:
1

Locations:
1–2

Shots:
8–10

Dialogue:
Minimal

Ending:
Cliffhanger
```

This tests:

```text
character consistency
shot planning
image generation
video generation
sound
Drive storage
cost
editing
```

without creating an enormous project.

---

# 54. Important Things NOT to Build Initially

Avoid:

```text
❌ Public hosting
❌ Login/register
❌ Payment system
❌ Subscription system
❌ Team accounts
❌ User permissions
❌ Mobile app
❌ Full timeline editor
❌ Direct YouTube publishing
❌ 20-minute automatic generation
❌ Supporting ten AI providers immediately
```

These add complexity without helping the first film.

---

# 55. Initial Provider Strategy

Start with:

```text
Text:
Manual ChatGPT workflow

Image:
One local or affordable image workflow

Video:
Local LTX
+
one inexpensive cloud fallback

Storage:
Google Drive

Editing:
DaVinci Resolve

Rendering utilities:
FFmpeg
```

Only add another provider when there is a real reason.

---

# 56. Future "Director" Mode

A future feature can act as an AI film director.

Before generation it checks:

```text
Does the character match the previous scene?
Are the clothes correct?
Is it still night?
Is the character holding the same object?
Is the camera direction consistent?
Did the character suddenly change age?
Does Shot B logically follow Shot A?
```

Call this:

```text
Continuity Checker
```

For a 20-minute project this will become extremely useful.

---

# 57. Future Asset Reuse

Do not regenerate things that already work.

Example:

```text
Village exterior
Old railway station
Rahim character
Sword
Ancient map
Night ambience
```

Maintain a reusable library.

This reduces:
- generation time,
- cloud cost,
- inconsistency.

---

# 58. Future Quality Modes

Add presets:

```text
DRAFT
Local generation
Lower resolution
Fast

STANDARD
Mix local + cheap cloud

PREMIUM
Best cloud provider
Higher resolution
More generation attempts
```

This lets you decide where money is worth spending.

---

# 59. Recommended Development Rule

For every new feature ask:

> Does this help me make the next video faster, cheaper, more consistent, or better?

If the answer is no, postpone it.

The purpose of the software is to make films, not to become a large software project for its own sake.

---

# 60. Final Recommended System

```text
                   IDEA
                     │
              ┌──────▼──────┐
              │ REEL / VIDEO│
              └──────┬──────┘
                     │
                 Research
                     │
                   Story
                     │
                  Script
                     │
          ┌──────────┼──────────┐
          │          │          │
      Characters  Locations    Props
          │          │          │
          └──────────┼──────────┘
                     │
                  Scenes
                     │
                 Shot List
                     │
             Storyboard Images
                     │
             Approved Frames
                     │
          ┌──────────┴──────────┐
          │                     │
       Local AI              Cloud AI
      LTX / Wan        Kling / etc.
          │                     │
          └──────────┬──────────┘
                     │
                 Video Clips
                     │
             Voice / Music / SFX
                     │
              Draft Timeline
                     │
                   FFmpeg
                     │
             DaVinci polishing
                     │
              FINAL VIDEO
                     │
                  YouTube
```

---

# 61. Key Portability Answer

**Can you buy a stronger laptop later, clone the Git repository and continue?**

Yes — **if this backup architecture is implemented**.

The ideal migration is:

```text
New laptop
↓
Clone Git
↓
Run setup
↓
Connect Google Drive
↓
Restore database
↓
Restore secrets
↓
Download AI models
↓
Continue working
```

Git alone restores only the code.

**Git + Google Drive project storage + database backups + model manifest + setup scripts** restores the whole working environment.

This portability should be treated as a core feature from Phase 1, not something added after hundreds of generated clips already exist.

---

# 62. Recommended Next Development Task

Start with:

> **Phase 1 — Local project shell + Reels/Videos project creation + SQLite + portable storage paths + Google Drive backup design**

Before AI generation, make sure:

```text
create project
save project
close app
restart app
reopen project
backup project
restore project
```

all work correctly.

Once the foundation is reliable, add the AI layer.

---

# 63. Implementation Status and Decision Register

This section records which blueprint alternatives have been selected. It is
updated whenever an implementation choice is made so the blueprint remains the
project's source of truth.

| Date | Area | Decision | Status |
|---|---|---|---|
| 2026-09-10 | Package management | pnpm workspace with strict TypeScript | Accepted |
| 2026-09-10 | Frontend | Next.js App Router, React, TypeScript, Tailwind CSS | Accepted |
| 2026-09-10 | Backend | Separate Fastify API bound to loopback only | Accepted |
| 2026-09-10 | Database | SQLite with repository boundaries and versioned SQL migrations | Accepted |
| 2026-09-10 | Background jobs | Persistent local runner first; BullMQ/Redis only when scaling evidence exists | Accepted |
| 2026-09-10 | Local AI | ComfyUI adapter boundary | Accepted for Phase 4+ |
| 2026-09-10 | Cloud video | Select one provider during Phase 6 after explicit cost/region review | Deferred |
| 2026-09-10 | Project content in Git | Excluded; Git contains application source and safe templates only | Accepted |
| 2026-09-10 | Story AI workflow | Manual ChatGPT prompt export and validated JSON import; no subscription automation or API charge | Accepted |
| 2026-09-10 | Story-plan persistence | Transactional replacement with story/script version increments, ordered scenes, and globally unique shot codes | Accepted |
| 2026-09-10 | Bible identity matching | Exact case-insensitive name or stable generated code; missing labels are unresolved and never fuzzy-guessed | Accepted |
| 2026-09-10 | Reference image storage | Project-local generated paths; JPEG/PNG/WebP only, 8 MB limit, MIME magic-byte verification, SHA-256 metadata | Accepted |
| 2026-09-10 | Shot prompt builder | Deterministic provider-neutral composition from project, shot, Bible, and reference records | Accepted |
| 2026-09-10 | Image attempt history | Immutable attempt, job, prompt/reference/settings snapshot, error, timing, cost, review, and asset records | Accepted |
| 2026-09-10 | Image job execution | Transactional SQLite queue with one local worker and startup recovery; Redis remains deferred | Accepted |
| 2026-09-10 | ComfyUI workflow contract | API-format JSON with exact runtime tokens and loopback-only HTTP access | Accepted; live workflow pending |
| 2026-09-10 | Offline image workflow | Manual JPEG/PNG/WebP import enters the same zero-cost review history | Accepted |
| 2026-09-10 | Cloud image provider | No provider selected and no automatic cloud spending | Deferred |

## Milestone progress

- [x] Architecture foundation and decision register
- [x] Phase 1A — Local Project Manager, portable manifests, backup and restore
- [ ] Phase 1B — Google Drive OAuth connection and verified backup upload
- [x] Phase 2 — Story System
- [x] Phase 3 — Character & Location Bible
- [x] Phase 4A — Image jobs, immutable history, manual fallback, and review UI
- [ ] Phase 4B — Live ComfyUI model/workflow render and Google Drive asset upload
- [ ] Phase 5 — Local Video
- [ ] Phase 6 — Cloud Video
- [ ] Phase 7 — Audio
- [ ] Phase 8 — Draft Renderer
- [ ] Phase 9 — Long Video Features

## Completed milestone evidence

### Phase 1A — Local Project Manager (2026-09-10)

- Next.js dashboard, project library, creative-brief form, project workspace, and
  storage/settings interface are implemented and visually checked in a live browser.
- Fastify is loopback-only, uses an origin allow-list, conservative payload/rate
  limits, security headers, runtime validation, and RFC 9457-style problem responses.
- SQLite uses WAL, foreign keys, busy timeouts, constraints, repositories, and a
  versioned migration ledger.
- Project creation/update writes a versioned `project.json` through a persistent
  transactional outbox; failures remain retryable and never discard database state.
- Backups use SQLite's online backup API, record size and SHA-256, verify integrity
  before restore, and create a rollback snapshot before replacing the active database.
- Automated tests cover persistence across reopen, search/filter/update, manifest
  containment and synchronization, create-to-restore API flow, validation problems,
  and untrusted browser origins.
- Repository checks passed: formatting, ESLint, strict TypeScript, seven automated
  tests, production Next.js/API builds, compiled API boot, and production dependency
  audit with no known vulnerabilities.

### Phase 2 — Story System (2026-09-10)

- The Story Room exports a creative-brief-specific ChatGPT request containing an
  exact provider-independent JSON contract and explicit prompt-injection boundary.
- JSON can be parsed and server-validated before any write; the review step shows
  story metadata, scene and shot counts, total shot duration, and target-duration
  drift before import.
- Story, script, scenes, and shots use strict shared schemas, database constraints,
  a versioned SQLite migration, transactional replacement, deterministic ordering,
  generated global shot codes, and Reel/long-video maximum-duration enforcement.
- The project workspace renders the resulting story arc, hook/twist/cliffhanger,
  screenplay scenes, and cinematography details for each shot. A real Reel idea was
  imported and reopened through the live browser workflow.
- Portable manifests now include story, script, scenes, and a flattened shot index;
  acceptance verification confirmed that the database write and manifest sync agree.
- Repository checks passed with thirteen automated tests covering contracts through
  API behavior, duplicate identifiers, duration limits, preflight support for PUT,
  persistence/versioning, manifest synchronization, and story-request construction.

### Phase 3 — Character & Location Bible (2026-09-10)

- Character, location, and prop records use project-scoped stable codes, strict
  shared schemas, case-insensitive name uniqueness, database constraints, and a
  versioned migration. Existing shots gain a backward-compatible prop-label list.
- The Visual Bible workspace supports creating and editing structured continuity
  records, browsing their stable codes, attaching view-labelled reference images,
  and reviewing per-shot reference coverage and composed prompts.
- Reference uploads use bounded multipart parsing and project-contained generated
  paths. JPEG, PNG, and WebP contents are magic-byte checked against the declared
  MIME type, filenames are sanitized, and SHA-256/size metadata is recorded.
- Shot inheritance resolves only exact names or stable codes across character,
  location, and prop Bibles. Missing records are visible and provider-neutral prompts
  automatically include all resolved facts and reference paths.
- The live test Reel now has Rahim and the abandoned station as Bible records; closing
  and reopening the workspace reports both shots resolved and displays their full
  inherited continuity prompts.
- Twenty-one automated tests pass across repositories, storage containment and MIME
  spoofing, resolver behavior, multipart API delivery, manifests, prior milestones,
  and end-to-end Visual Bible coverage.

### Phase 4A — Image Generation Pipeline (2026-09-10)

- A provider package isolates ComfyUI behind a typed image interface and validates
  a loopback-only base URL, readable API-format workflow, mandatory substitution
  tokens, prompt submission, history polling, reference upload, and output download.
- SQLite stores durable generation jobs, immutable attempt provenance, review state,
  structured failure details, and generated-asset metadata. Transactional claims
  prevent duplicate local work and startup recovery requeues interrupted jobs.
- Storyboard files use project-contained generated paths, content-derived MIME type,
  SHA-256, byte size, and available dimensions. Manual imports follow the identical
  history/review path and record zero provider cost.
- The Storyboard workspace reports provider readiness, continuity blockers, warning
  references, job progress, image alternatives, seed/model/time/cost/error facts,
  and explicit approve/reject controls with one selected frame per shot.
- Thirty-one automated tests pass across all four milestones, including attempt history,
  single-selection invariants, crash recovery, storage containment and spoofing,
  ComfyUI request/response behavior, manual import, asset delivery, manifest sync,
  review, and precise offline/configuration errors.
- Live ComfyUI generation remains pending because no reachable configured local
  runtime, selected model, or exported workflow was available during acceptance.
