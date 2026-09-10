# ADR 0001: Local-first application foundation

- Status: accepted
- Date: 2026-09-10

## Context

AI Film Studio is a single-user application that must survive provider changes,
preserve expensive generation history, and move cleanly between Macs. It does not
need public hosting, identity, billing, or multi-tenancy. The first milestone must
support durable project creation, reopening, backup, and restore before AI work is
added.

## Decision

Use a pnpm TypeScript monorepo with these deployable applications and boundaries:

- `apps/web`: Next.js App Router UI. It never opens SQLite or arbitrary files.
- `apps/api`: Fastify HTTP API bound to `127.0.0.1` by default.
- `packages/contracts`: shared, runtime-validated transport/domain contracts.
- `packages/database`: SQLite migrations and repositories.
- `packages/storage`: portable project manifests and backup implementations.
- later provider packages implement text, image, video, voice, and object-storage
  ports without changing the project domain.

SQLite is the authoritative application database. A versioned `project.json` is
an interoperable export and recovery artifact, not a second independently edited
source of truth. Project assets and database backups stay outside Git.

The API uses explicit schemas, conservative body limits, allow-listed browser
origins, loopback binding, generated identifiers, and storage-root containment.
Even though the app is local, provider secrets are never returned to the browser
or written to project manifests.

Long-running jobs start behind a persistent local job interface. Redis and BullMQ
are deferred until concurrent workers or distributed execution are actually
required. This keeps first-run and restore workflows one-service simple.

## Consequences

- The UI and API can evolve independently, at the cost of maintaining a small
  versioned HTTP contract.
- SQLite remains easy to copy and restore, while repository interfaces contain
  the cost of a future database change.
- Local setup has fewer services during the earliest phases.
- Paid provider selection remains a configuration decision rather than a domain
  or database redesign.

## Deferred decisions

- The Phase 6 cloud-video fallback requires explicit review of price, region,
  quality, and credentials.
- Google Drive OAuth details are selected when its storage adapter is implemented;
  Phase 1 first establishes a tested local backup port with the same semantics.
- macOS Keychain integration follows the environment-variable baseline.
