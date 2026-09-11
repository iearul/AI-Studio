# ADR 0005: Approved-frame video production with explicit cloud spending

- Status: Accepted
- Date: 2026-09-11

## Context

Video generation is expensive, asynchronous, and provider result links expire. The
local image runtime was already removed because it made the 18 GB M3 Pro unreliable.
A video implementation must not recreate that pressure or spend cloud credit without
an unmistakable user action.

## Decision

- Every video attempt starts from the currently selected, approved storyboard image.
- A deterministic image-to-video prompt snapshots the action, camera, lighting,
  emotional intent, frame ratio, and strict identity/geometry continuity rules.
- Manual MP4, MOV, and WebM imports are always available and record zero API cost.
- Kling 3.0 and BytePlus Seedance 2.0 implement one shared asynchronous provider
  boundary. Provider keys stay server-side in ignored environment files.
- A paid request is accepted only with the literal server-validated confirmation
  token emitted after the UI displays provider, duration, resolution, audio choice,
  and the best available USD estimate.
- Attempts, provider task IDs, settings, failures, cost, review, and selected state
  are immutable history in SQLite. One active task and one selected video are allowed
  per shot.
- A persistent in-process poller resumes submitted tasks. Completed outputs are
  downloaded immediately from allow-listed HTTPS provider domains and streamed into
  project-local storage with a 512 MB limit, magic-byte checks, and SHA-256 metadata.
- The project manifest includes video attempts and assets. Browser delivery supports
  byte ranges so saved clips can be reviewed without loading the whole file.

## Consequences

- No local video model is installed or started on the Mac. Manual creation remains
  free of per-request API charges; Kling and Seedance charge the user's own account.
- Seedance 2.0 uses the documented 720p image-to-video path and displays its current
  real-human-face material-library restriction.
- Kling pricing can vary by account or package. An optional configured per-second
  estimate is shown before submission, and actual returned USD cash billing replaces
  the estimate when Kling reports it.
- The application keeps working when a provider is unconfigured or unavailable;
  failures do not remove prior images, videos, or project data.
