# ADR 0003: API and manual image creation with durable review

- Status: Accepted
- Date: 2026-09-10
- Revised: 2026-10-11

## Context

Image generation may produce several valuable alternatives for one shot. The first
implementation used ComfyUI locally, but its runtime and diffusion models created
unacceptable memory pressure and did not complete reliably on the 18 GB M3 Pro.
The durable review model remains useful whether images come from a cloud API or
from a separate ChatGPT session.

## Decision

- AI Film Studio builds detailed prompts for character references and individual
  shots. No local image model is installed or started.
- OpenAI GPT Image and Google Gemini implement one image provider boundary and are
  selectable per request. OpenAI uses the Images API (`/v1/images/edits` when
  reference photos are attached); Gemini uses the Interactions API with
  `store: false`. Keys stay server-side in ignored environment files.
- A paid request is accepted only with the literal server-validated confirmation
  token that the UI sends after showing the provider, model, quality, number of
  reference photos, and estimated USD cost.
- Shot generation sends the shot's Visual Bible photos, each entity's best view
  first, within the model's image limit and a per-provider byte budget; skipped
  photos are recorded on the attempt. Character reference generation sends that
  character's existing views. The prompt lists the attached photos in order.
- Shot generation runs in the background inside the API process. A partial unique
  index allows one active paid attempt per shot; attempts still running when the
  process stops are marked failed at the next start.
- Recorded cost is computed from returned token usage at the published OpenAI rates,
  or from Gemini's published per-image price plus input tokens. Costs are USD.
- Manual ChatGPT imports remain available, record the `manual` provider, and cost
  nothing. Generated and imported images enter immutable review history beneath the
  project with MIME magic-byte verification, SHA-256, byte size, and contained paths.
- Approving an attempt atomically makes it the only selected image for that shot.
- Historical ComfyUI records remain readable so existing project history is not
  destroyed, but no ComfyUI route, adapter, worker, or UI control remains.

## Consequences

- Retrying never destroys evidence, and downstream video work can reference a
  stable approved asset.
- API generation charges the user's own OpenAI or Google account; manual creation
  remains free of per-request API charges.
- An interrupted background request may still be billed by the provider even though
  no image is saved.
- Generated character reference photos are stored like uploads and do not carry a
  recorded cost.
