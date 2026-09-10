import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ComfyUiImageProvider } from "../src/comfyui-image-provider.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlT5ZkAAAAASUVORK5CYII=",
  "base64",
);

describe("ComfyUiImageProvider", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("substitutes an API workflow, polls history, and downloads its image", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "film-studio-comfy-"));
    const workflowPath = path.join(directory, "workflow.json");
    await writeFile(
      workflowPath,
      JSON.stringify({
        "1": {
          class_type: "TestNode",
          inputs: {
            prompt: "{{PROMPT}}",
            negative: "{{NEGATIVE_PROMPT}}",
            seed: "{{SEED}}",
            width: "{{WIDTH}}",
            height: "{{HEIGHT}}",
            prefix: "{{FILENAME_PREFIX}}",
            note: "model={{MODEL}}",
          },
        },
      }),
    );
    let queuedWorkflow: unknown;
    const mockFetch = vi.fn<typeof fetch>((input, init) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : input;
      if (url.endsWith("/prompt")) {
        if (typeof init?.body !== "string") {
          throw new Error("Expected a JSON request body.");
        }
        queuedWorkflow = JSON.parse(init.body) as unknown;
        return Promise.resolve(Response.json({ prompt_id: "prompt-123" }));
      }
      if (url.includes("/history/")) {
        return Promise.resolve(
          Response.json({
            "prompt-123": {
              outputs: {
                "9": {
                  images: [
                    {
                      filename: "frame.png",
                      subfolder: "",
                      type: "output",
                    },
                  ],
                },
              },
              status: { status_str: "success", completed: true },
            },
          }),
        );
      }
      if (url.includes("/view?")) {
        return Promise.resolve(
          new Response(Uint8Array.from(png), {
            headers: { "content-type": "image/png" },
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const provider = new ComfyUiImageProvider(
      {
        baseUrl: "http://127.0.0.1:8188",
        workflowPath,
        model: "flux-dev.safetensors",
        timeoutMs: 10_000,
        pollIntervalMs: 1,
      },
      {
        fetch: mockFetch,
        readFile: (await import("node:fs/promises")).readFile,
        sleep: () => Promise.resolve(),
      },
    );
    const events: number[] = [];
    const result = await provider.generate(
      {
        prompt: "A moonlit platform",
        negativePrompt: "blur",
        seed: 42,
        width: 768,
        height: 1344,
        filenamePrefix: "shot-001",
        references: [],
      },
      (progress) => {
        events.push(progress.progress);
      },
    );

    expect(queuedWorkflow).toMatchObject({
      prompt: {
        "1": {
          inputs: {
            prompt: "A moonlit platform",
            negative: "blur",
            seed: 42,
            width: 768,
            height: 1344,
            prefix: "shot-001",
            note: "model=flux-dev.safetensors",
          },
        },
      },
    });
    expect(result).toMatchObject({
      filename: "frame.png",
      mimeType: "image/png",
      providerJobId: "prompt-123",
    });
    expect(result.buffer).toEqual(png);
    expect(events).toEqual([15, 30, 90]);
  });

  it("reports missing workflow/model configuration without a network call", async () => {
    const provider = new ComfyUiImageProvider({
      baseUrl: "http://127.0.0.1:8188",
      workflowPath: null,
      model: null,
      timeoutMs: 10_000,
      pollIntervalMs: 1,
    });
    await expect(provider.getStatus()).resolves.toMatchObject({
      configured: false,
      available: false,
    });
  });
});
