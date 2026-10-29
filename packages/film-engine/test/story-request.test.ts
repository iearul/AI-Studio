import { projectSchema } from "@ai-studio/contracts";
import { describe, expect, it } from "vitest";

import { buildStoryRequest } from "../src/story-request.js";

describe("buildStoryRequest", () => {
  it("builds a provider-independent Reel request with exact constraints", () => {
    const project = projectSchema.parse({
      id: "186a643e-4503-4c7f-83d8-d21596d0ad0a",
      slug: "the-last-train-186a643e",
      title: "The Last Train",
      type: "reel",
      topic: "A lost train returns.",
      language: "en",
      targetDurationSeconds: 60,
      aspectRatio: "9:16",
      style: "mystery",
      narration: "narrator",
      status: "draft",
      createdAt: "2026-09-10T12:00:00.000Z",
      updatedAt: "2026-09-10T12:00:00.000Z",
    });
    const request = buildStoryRequest(project);

    expect(request.filename).toBe("the-last-train-186a643e-story-request.txt");
    expect(request.prompt).toContain("0–3s hook");
    expect(request.prompt).toContain('"targetDurationSeconds": 60');
    expect(request.prompt).toContain("Return JSON only");
    expect(request.prompt).toContain("medium-close-up");
  });
});
