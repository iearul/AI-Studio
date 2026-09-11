# ADR 0003: Manual ChatGPT image creation and durable review

- Status: Superseded in part
- Date: 2026-09-10
- Revised: 2026-09-11

## Context

Image generation may produce several valuable alternatives for one shot. The first
implementation used ComfyUI locally, but its runtime and diffusion models created
unacceptable memory pressure and did not complete reliably on the 18 GB M3 Pro.
The durable review model remains useful when images are created in ChatGPT.

## Decision

- AI Film Studio does not call a local or paid image-generation API. It builds
  detailed prompts for character references and individual shots.
- The user copies a prompt into ChatGPT, creates the image there, and uploads the
  result to the corresponding character or shot.
- Imported images enter immutable review history and are stored beneath the project
  with MIME magic-byte verification, SHA-256, byte size, and contained paths.
- Approving an attempt atomically makes it the only selected image for that shot.
  Manual imports record the `manual` provider and zero provider cost.
- Historical ComfyUI records remain readable so existing project history is not
  destroyed, but no provider route, adapter, worker, workflow, or UI control remains.

## Consequences

- Retrying never destroys evidence, and downstream video work can reference a
  stable approved asset.
- Image creation happens in a separate ChatGPT session and requires a deliberate
  copy/create/upload step.
- Removing the local diffusion runtime frees substantial disk and unified memory.
