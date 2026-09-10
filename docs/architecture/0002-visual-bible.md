# ADR 0002: Deterministic Visual Bible and Local Reference Images

- Status: Accepted
- Date: 2026-09-10

## Context

Shots initially carry human-readable character, location, and prop labels because
they arrive through the manual story-plan workflow. Media generation needs stable,
portable continuity records without silently associating a shot with the wrong
subject. Reference images also need a safe local upload path before any generation
provider is introduced.

## Decision

- Characters, locations, and props are first-class SQLite records with immutable
  generated codes, project-scoped case-insensitive names, structured continuity
  fields, and portable reference metadata.
- A shot resolves a label only by an exact case-insensitive name or exact stable
  code. Missing labels are reported as unresolved; fuzzy guessing is prohibited.
- The provider-neutral prompt builder combines the project visual style, shot,
  cinematography, resolved Bible facts, and all recorded reference-image paths.
- Reference images are stored below the owning project using generated filenames.
  Uploads allow one JPEG, PNG, or WebP file up to 8 MB, and the declared MIME type
  must match magic-byte detection. SVG is not accepted because it can contain active
  content.
- SQLite records store the relative path, byte count, SHA-256, view, and original
  display filename. The portable manifest includes all Bible and reference metadata.
- The maintained `@fastify/multipart` 10.1.1 line handles streaming multipart input;
  the selected minimum excludes the known aborted-upload denial-of-service range.

## Consequences

- Renaming a Bible entry does not change its stable code, and a screenplay can use
  that code to remain linked across later name edits.
- Existing story plans remain compatible because shot prop labels migrate to an
  empty array.
- Image generation adapters can consume the same prompt context and paths without
  changing the Bible or shot models.
- Project asset backup to Google Drive remains part of Phase 1B/Phase 4; the local
  reference files are already colocated with the portable project.
