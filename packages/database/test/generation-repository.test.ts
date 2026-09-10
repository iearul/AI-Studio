import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseManager } from "../src/database-manager.js";
import {
  GenerationRepository,
  GenerationStateError,
} from "../src/generation-repository.js";
import { ProjectRepository } from "../src/project-repository.js";
import { StoryPlanRepository } from "../src/story-plan-repository.js";

describe("GenerationRepository", () => {
  let directory: string;
  let manager: DatabaseManager;
  let repository: GenerationRepository;
  let projectId: string;
  let shotId: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "film-studio-generation-"));
    manager = new DatabaseManager(path.join(directory, "test.sqlite"));
    await manager.open();
    const projects = new ProjectRepository(manager);
    projectId = projects.create({
      title: "The Last Train",
      type: "reel",
      topic: "A lost train returns.",
      language: "en",
      targetDurationSeconds: 30,
      aspectRatio: "9:16",
      style: "mystery",
      narration: "narrator",
    }).id;
    const plan = new StoryPlanRepository(manager, projects).save(projectId, {
      story: {
        title: "The Last Train",
        logline: "A station keeper sees an impossible train.",
        genre: "Mystery",
        theme: "Grief",
        tone: "Ominous",
        mainConflict: "Rahim must choose whether to board.",
        mainCharacter: "Rahim",
        supportingCharacters: [],
        beginning: "A signal wakes.",
        middle: "A train arrives.",
        climax: "The door opens.",
        ending: "The lights fail.",
        audienceEmotion: "Unease",
        retentionMoments: [],
      },
      script: { title: "The Last Train" },
      scenes: [
        {
          sceneNumber: 1,
          location: "Platform",
          timeOfDay: "Night",
          characters: ["Rahim"],
          action: "A signal wakes.",
          estimatedDurationSeconds: 4,
          emotionalPurpose: "Hook",
          shots: [
            {
              code: "SHOT_001",
              durationSeconds: 4,
              characters: ["Rahim"],
              location: "Platform",
              shotType: "wide",
              cameraAngle: "eye-level",
              lens: "35mm",
              cameraMovement: "static",
              action: "The signal turns green.",
              lighting: "Moonlight",
              emotion: "Unease",
            },
          ],
        },
      ],
    });
    shotId = plan.scenes[0]!.shots[0]!.id;
    repository = new GenerationRepository(manager, projects);
  });

  afterEach(async () => {
    manager.close();
    await rm(directory, { recursive: true, force: true });
  });

  function queued() {
    return repository.queueImage({
      projectId,
      shotId,
      provider: "comfyui",
      model: "flux-dev.safetensors",
      prompt: "A moonlit platform",
      negativePrompt: "blurred",
      references: [],
      seed: 42,
      settings: { width: 768, height: 1344 },
    });
  }

  it("preserves immutable attempts and selects only one approved image", () => {
    const first = queued();
    expect(repository.claimNextImageJob()?.id).toBe(first.id);
    const firstDone = repository.completeAttempt(
      projectId,
      first.id,
      {
        originalFilename: "first.png",
        relativePath: `storyboard/${shotId}/${first.id}.png`,
        mimeType: "image/png",
        byteSize: 68,
        sha256: "a".repeat(64),
        width: 1,
        height: 1,
      },
      1200,
      "comfy-1",
    );
    repository.review(projectId, firstDone.id, "approve");

    const second = queued();
    repository.claimNextImageJob();
    repository.completeAttempt(
      projectId,
      second.id,
      {
        originalFilename: "second.png",
        relativePath: `storyboard/${shotId}/${second.id}.png`,
        mimeType: "image/png",
        byteSize: 68,
        sha256: "b".repeat(64),
        width: 1,
        height: 1,
      },
      900,
      "comfy-2",
    );
    repository.review(projectId, second.id, "approve");

    const history = repository.listProject(projectId);
    expect(history.attempts).toHaveLength(2);
    expect(
      history.attempts.find((item) => item.id === second.id)?.selected,
    ).toBe(true);
    expect(
      history.attempts.find((item) => item.id === first.id)?.selected,
    ).toBe(false);
    expect(history.totals).toMatchObject({ attempts: 2, succeeded: 2 });
  });

  it("records failures, rejects invalid reviews, and requeues interrupted jobs", () => {
    const attempt = queued();
    repository.claimNextImageJob();
    expect(() => repository.review(projectId, attempt.id, "approve")).toThrow(
      GenerationStateError,
    );
    expect(repository.requeueInterruptedJobs()).toBe(1);
    expect(repository.claimNextImageJob()?.id).toBe(attempt.id);
    const failed = repository.failAttempt(
      projectId,
      attempt.id,
      new Error("GPU allocation failed"),
    );
    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toContain("GPU allocation");
  });
});
