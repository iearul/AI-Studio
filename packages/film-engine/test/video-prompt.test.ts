import { describe, expect, it } from "vitest";

import type { Project, Shot } from "@ai-studio/contracts";

import { buildVideoPrompt } from "../src/video-prompt.js";

describe("buildVideoPrompt", () => {
  it("turns a shot into an image-to-video continuity contract", () => {
    const prompt = buildVideoPrompt(
      {
        id: "00000000-0000-4000-8000-000000000001",
        slug: "test",
        title: "Test",
        type: "reel",
        topic: "A mysterious station signal.",
        language: "en",
        customLanguage: null,
        targetDurationSeconds: 30,
        aspectRatio: "9:16",
        style: "cinematic",
        customStyle: null,
        narration: "none",
        targetAudience: null,
        tone: null,
        ageRating: null,
        countryCulture: null,
        visualStyle: "Naturalistic 35mm film",
        desiredEnding: null,
        status: "draft",
        createdAt: "2026-09-11T10:00:00.000Z",
        updatedAt: "2026-09-11T10:00:00.000Z",
      } satisfies Project,
      {
        id: "00000000-0000-4000-8000-000000000002",
        projectId: "00000000-0000-4000-8000-000000000001",
        sceneId: "00000000-0000-4000-8000-000000000003",
        position: 0,
        code: "SHOT_001",
        durationSeconds: 5,
        characters: ["Rahim"],
        props: [],
        location: "Station",
        shotType: "medium-close-up",
        cameraAngle: "eye-level",
        lens: "50mm",
        cameraMovement: "slow-push-in",
        action: "Rahim slowly looks over his shoulder.",
        lighting: "Cold moonlight",
        emotion: "Dread",
        status: "approved",
        createdAt: "2026-09-11T10:00:00.000Z",
        updatedAt: "2026-09-11T10:00:00.000Z",
      } satisfies Shot,
    );

    expect(prompt).toContain("continuous 5-second cinematic shot");
    expect(prompt).toContain("slow-push-in");
    expect(prompt).toContain("supplied approved storyboard image");
    expect(prompt).toContain("No cuts");
  });
});
