# ComfyUI image workflow contract

AI Film Studio submits a ComfyUI workflow exported in **API format**. Keep a
configured workflow JSON in this directory (or elsewhere below the repository)
and set its relative path in `.env`:

```dotenv
COMFYUI_IMAGE_WORKFLOW_PATH=config/comfyui/image-workflow.json
COMFYUI_IMAGE_MODEL=your-model-file.safetensors
```

Replace the corresponding widget values in the API-format JSON with these exact
tokens:

| Token                   | Runtime value                            |
| ----------------------- | ---------------------------------------- |
| `{{PROMPT}}`            | Deterministic shot and continuity prompt |
| `{{NEGATIVE_PROMPT}}`   | User-supplied negative prompt            |
| `{{SEED}}`              | Recorded integer seed                    |
| `{{WIDTH}}`             | Requested width                          |
| `{{HEIGHT}}`            | Requested height                         |
| `{{FILENAME_PREFIX}}`   | Project-safe output prefix               |
| `{{MODEL}}`             | `COMFYUI_IMAGE_MODEL` value              |
| `{{REFERENCE_IMAGE_1}}` | First uploaded reference, when used      |
| `{{REFERENCE_IMAGE_2}}` | Second uploaded reference, when used     |

The seven non-reference tokens are mandatory. Reference tokens are optional and
may be added sequentially to `LoadImage` nodes. The backend uploads matching
project reference files to ComfyUI before queueing the prompt.

The selected workflow JSON is intentionally not committed because its node graph
depends on the locally installed ComfyUI custom nodes and model family. Once a
workflow is selected and acceptance-tested, it should be committed as a safe
configuration artifact without model weights or private media.
