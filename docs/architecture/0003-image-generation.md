# ADR 0003: Durable local image generation and review

- Status: Accepted
- Date: 2026-09-10

## Context

Image generation can be slow, can fail after submission, and may produce several
valuable alternatives for one shot. ComfyUI and its model graph are external local
dependencies, while the application must remain useful when they are offline.
Generated media must also retain enough provenance for review, reproducibility,
cost reporting, recovery, and later image-to-video work.

## Decision

- `packages/providers` owns the provider interface and ComfyUI HTTP adapter. The
  domain, database, storage, and browser never depend on ComfyUI response shapes.
- ComfyUI is restricted to an HTTP loopback URL. It receives an API-format workflow
  with mandatory exact tokens for prompt, negative prompt, seed, size, filename,
  and model. Reference images are uploaded through the local API before submission.
- A persistent SQLite job is claimed transactionally by one in-process worker.
  At most one active job may exist per shot. Interrupted external work is marked
  failed on startup and requires an explicit retry; it is never blindly replayed
  because ComfyUI may still be executing the original prompt. BullMQ/Redis remains
  deferred for a single-machine workload.
- Every request creates an immutable generation-attempt record containing prompt,
  references, settings, seed, model, provider, state, error, time, and cost. The
  resulting image is stored beneath its project with MIME magic-byte verification,
  SHA-256, byte size, and contained generated paths.
- Generated and manually imported images enter the same review history. Approving
  an attempt atomically makes it the only selected image for that shot. Manual
  imports record the `manual` provider and zero provider cost.
- Provider availability is explicit in the API and UI. No cloud image provider is
  selected or charged automatically. Google Drive upload remains pending the
  separately tracked OAuth milestone.
- The M3 Pro/18 GB installation uses the official Z-Image Turbo INT8 ConvRot
  diffusion model with the FP8 mixed Qwen encoder. Default dimensions follow each
  project's aspect ratio and avoid the larger BF16 combination that exhausted
  unified memory during live acceptance.

## Consequences

- Retrying never destroys evidence, and downstream video work can reference a
  stable approved asset.
- The storyboard workflow remains usable without an AI runtime, while the UI makes
  offline or incomplete ComfyUI setup visible.
- Progress is intentionally coarse and evidence-based: submitted, waiting for a
  ComfyUI result, and downloading. The UI does not invent percentages while an
  opaque model step is running.
