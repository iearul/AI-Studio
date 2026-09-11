# ComfyUI image workflow contract

AI Film Studio submits a ComfyUI workflow exported in **API format**. Keep a
configured workflow JSON in this directory (or elsewhere below the repository)
and set its relative path in `.env`:

```dotenv
COMFYUI_IMAGE_WORKFLOW_PATH=config/comfyui/image-workflow.json
COMFYUI_IMAGE_MODEL=z_image_turbo_bf16.safetensors
```

Replace the corresponding widget values in the API-format JSON with these exact
tokens:

| Token                   | Runtime value                            |
| ----------------------- | ---------------------------------------- |
| `{{PROMPT}}`            | Deterministic shot and continuity prompt |
| `{{NEGATIVE_PROMPT}}`   | Optional user-supplied negative prompt   |
| `{{SEED}}`              | Recorded integer seed                    |
| `{{WIDTH}}`             | Requested width                          |
| `{{HEIGHT}}`            | Requested height                         |
| `{{FILENAME_PREFIX}}`   | Project-safe output prefix               |
| `{{MODEL}}`             | `COMFYUI_IMAGE_MODEL` value              |
| `{{REFERENCE_IMAGE_1}}` | First uploaded reference, when used      |
| `{{REFERENCE_IMAGE_2}}` | Second uploaded reference, when used     |

All non-reference tokens except `{{NEGATIVE_PROMPT}}` are mandatory. The selected
Z-Image Turbo workflow follows the official graph and uses zeroed negative
conditioning, so it does not consume a negative-prompt token. Reference tokens are
optional and may be added sequentially to `LoadImage` nodes. The backend uploads
matching project reference files to ComfyUI before queueing the prompt.

`image-workflow.json` is the committed, API-format Z-Image Turbo graph. It uses
only ComfyUI core nodes, the diffusion-model filename remains configurable, and
the required text encoder and VAE filenames match ComfyUI Desktop's starter-model
installation. Model weights and private media remain outside the repository.

## Local runtime

1. Open **Comfy Desktop** and start the `ComfyUI` local instance.
2. Confirm its API is available at <http://127.0.0.1:8188/system_stats>.
3. Copy `.env.example` to `.env.local` and retain the checked-in ComfyUI values.
4. Start AI Film Studio with `pnpm dev`, open a project's Storyboard, and use
   **Generate with ComfyUI**.

The first generation has to load roughly 19 GB of model components and is slower
than later generations. All generation stays on this Mac and records zero provider
cost. Z-Image Turbo does not use reference images in this first workflow; uploaded
Bible references remain visible as continuity warnings and are reserved for a
future reference-conditioning workflow.
