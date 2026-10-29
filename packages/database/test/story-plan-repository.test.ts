import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { StoryPlanInput } from "@ai-studio/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseManager } from "../src/database-manager.js";
import { ManifestOutboxRepository } from "../src/manifest-outbox-repository.js";
import { ProjectRepository } from "../src/project-repository.js";
import {
  StoryPlanDurationError,
  StoryPlanRepository,
} from "../src/story-plan-repository.js";

const planInput: StoryPlanInput = {
  story: {
    title: "The Last Train",
    logline: "A station keeper sees a train that vanished twenty years ago.",
    genre: "Mystery horror",
    theme: "Grief refuses to follow a timetable.",
    tone: "Quiet and ominous",
    mainConflict: "Rahim must decide whether to board the impossible train.",
    mainCharacter: "Rahim",
    supportingCharacters: [],
    beginning: "Rahim closes an abandoned station at midnight.",
    middle: "A signal turns green and the lost train approaches.",
    climax: "The carriage door opens and his own voice calls from inside.",
    ending: "Rahim steps closer as the platform lights go black.",
    audienceEmotion: "Uneasy curiosity",
    hook: "A dead railway signal turns green by itself.",
    twist: "The voice inside the train belongs to Rahim.",
    cliffhanger: "A hand reaches out wearing Rahim's watch.",
    retentionMoments: ["Signal turns green", "Train number is revealed"],
  },
  script: { title: "The Last Train — Reel", notes: "Minimal dialogue." },
  scenes: [
    {
      sceneNumber: 1,
      location: "Abandoned railway platform",
      timeOfDay: "Night",
      characters: ["Rahim"],
      action: "Rahim locks the station office as a dead signal wakes.",
      narration: "No train had stopped here for twenty years.",
      dialogue: null,
      estimatedDurationSeconds: 8,
      emotionalPurpose: "Hook with an impossible event",
      shots: [
        {
          code: "SHOT_001",
          durationSeconds: 4,
          characters: ["Rahim"],
          location: "Abandoned railway platform",
          shotType: "wide",
          cameraAngle: "eye-level",
          lens: "35mm",
          cameraMovement: "slow-push-in",
          action: "The dead signal changes from red to green behind Rahim.",
          lighting: "Cold moonlight and a single green signal",
          emotion: "Unease",
          status: "draft",
        },
        {
          code: "SHOT_002",
          durationSeconds: 4,
          characters: ["Rahim"],
          location: "Abandoned railway platform",
          shotType: "close-up",
          cameraAngle: "eye-level",
          lens: "85mm",
          cameraMovement: "static",
          action: "Rahim slowly looks up from the padlock.",
          lighting: "Soft blue edge light",
          emotion: "Disbelief",
          status: "draft",
        },
      ],
    },
  ],
};

describe("StoryPlanRepository", () => {
  let directory: string;
  let manager: DatabaseManager;
  let projects: ProjectRepository;
  let plans: StoryPlanRepository;
  let projectId: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "ai-studio-plan-"));
    manager = new DatabaseManager(path.join(directory, "test.sqlite"));
    await manager.open();
    projects = new ProjectRepository(manager);
    projectId = projects.create({
      title: "The Last Train",
      type: "reel",
      topic: "A lost train returns after twenty years.",
      language: "en",
      targetDurationSeconds: 60,
      aspectRatio: "9:16",
      style: "mystery",
      narration: "narrator",
    }).id;
    new ManifestOutboxRepository(manager).complete(projectId);
    plans = new StoryPlanRepository(manager, projects);
  });

  afterEach(async () => {
    manager.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("saves a distinct story, script, scene hierarchy, and global shot codes", () => {
    const saved = plans.save(projectId, planInput);

    expect(saved.story.mainCharacter).toBe("Rahim");
    expect(saved.script.title).toContain("Reel");
    expect(saved.scenes).toHaveLength(1);
    expect(saved.scenes[0]?.shots.map((shot) => shot.code)).toEqual([
      "SHOT_001",
      "SHOT_002",
    ]);
    expect(saved.totals).toEqual({
      scenes: 1,
      shots: 2,
      shotDurationSeconds: 8,
    });
    expect(new ManifestOutboxRepository(manager).count()).toBe(1);
  });

  it("increments plan versions while preserving story and script identities", () => {
    const first = plans.save(projectId, planInput);
    const second = plans.save(projectId, {
      ...planInput,
      story: { ...planInput.story, tone: "Dreamlike and ominous" },
    });

    expect(second.story.id).toBe(first.story.id);
    expect(second.story.version).toBe(2);
    expect(second.script.id).toBe(first.script.id);
    expect(second.script.version).toBe(2);
    expect(second.story.tone).toBe("Dreamlike and ominous");
  });

  it("rejects a Reel plan above the hard duration limit without partial writes", () => {
    const tooLong = structuredClone(planInput);
    const sourceShot = tooLong.scenes[0]!.shots[0]!;
    tooLong.scenes[0]!.shots = Array.from({ length: 4 }, (_, index) => ({
      ...sourceShot,
      code: `SHOT_${String(index + 1).padStart(3, "0")}`,
      durationSeconds: 30,
    }));

    expect(() => plans.save(projectId, tooLong)).toThrow(
      StoryPlanDurationError,
    );
    expect(plans.get(projectId)).toBeUndefined();
    expect(new ManifestOutboxRepository(manager).count()).toBe(0);
  });
});
