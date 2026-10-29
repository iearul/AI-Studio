# ADR 0006: Google Drive OSPO backup boundary

- Status: Accepted
- Date: 2026-09-12

## Context

Project manifests and generated media must be portable off the Mac, while SQLite
backups must remain reliable when a cloud provider is disconnected. Google OAuth
credentials are sensitive, and a local-first application should not request access
to unrelated files already present in the user's Drive.

## Decision

- Use OAuth 2.0 authorization-code consent with the narrow `drive.file` scope. The
  callback binds to the loopback API and validates a short-lived cryptographic state.
- Create one visible, fixed hierarchy: `OSPO/AI-Film-Studio/projects` for portable
  project files and `OSPO/AI-Film-Studio/backups/database` for SQLite snapshots.
- Store refresh/access tokens only in the Git-ignored local secrets directory. The
  directory is owner-only (0700), the token file is owner-only (0600), and neither
  tokens nor client secrets enter browser responses or manifests.
- Find app-created children by exact parent and name, create missing folders, and use
  resumable uploads to create or update files. Trust only Google HTTPS upload hosts,
  never follow redirects, and never replay a consumed upload stream after HTTP 401.
- A full sync first drains portable manifests, walks regular non-symlink project
  files, creates a fresh verified SQLite online backup, uploads everything, and only
  then records the completed sync time.
- Manual backup remains local-first: backup success is returned even if remote upload
  is unavailable, with Drive failure reported separately. Disconnect removes only
  the local credential and never deletes remote data.

## Consequences

- Google consent is an explicit one-time user action; configured credentials alone
  are shown as ready to connect, never as connected.
- `drive.file` limits the application to files it creates or the user explicitly
  opens with it, substantially reducing account exposure.
- Sync is intentionally conservative and does not perform remote deletion. Old
  backups therefore follow a future explicit retention/cleanup policy.
- Live acceptance requires a Google Cloud OAuth client and user consent, while all
  deterministic behavior is covered with isolated automated tests.

## Update 2026-10-29: KDP Story Studio folder

The app is now called AI Studio and has more than one studio. Film Studio keeps
`OSPO/AI-Film-Studio` unchanged. KDP Story Studio books go to
`OSPO/KDP-Story-Studio/books/<book id>/`: a `book.json` data backup plus the
book's covers and exports. Creating or duplicating a book uploads its folder at
once when Drive is connected; a full sync re-uploads every book that is not in
the trash. Database snapshots still go to `OSPO/AI-Film-Studio/backups/database`
and cover the whole app. Drive uploads run one at a time so concurrent syncs
cannot create a folder twice. Later studios get their own sibling folder.
