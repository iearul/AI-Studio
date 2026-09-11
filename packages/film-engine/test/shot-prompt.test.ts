import {
  bibleSchema,
  projectSchema,
  storyPlanSchema,
} from "@ai-film-studio/contracts";
import { describe, expect, it } from "vitest";

import { buildReferenceCoverage } from "../src/shot-prompt.js";

const timestamp = "2026-09-10T12:00:00.000Z";
const projectId = "186a643e-4503-4c7f-83d8-d21596d0ad0a";
const project = projectSchema.parse({
  id: projectId,
  slug: "the-last-train-186a643e",
  title: "The Last Train",
  type: "reel",
  topic: "A lost train returns.",
  language: "en",
  targetDurationSeconds: 60,
  aspectRatio: "9:16",
  style: "mystery",
  narration: "narrator",
  visualStyle: "Naturalistic 35mm night photography",
  status: "draft",
  createdAt: timestamp,
  updatedAt: timestamp,
});
const plan = storyPlanSchema.parse({
  story: {
    id: "58a2f559-333f-4da7-b13d-28d1d16061c1",
    projectId,
    title: "The Last Train",
    logline: "A station keeper sees a train that vanished twenty years ago.",
    genre: "Mystery",
    theme: "Grief",
    tone: "Ominous",
    mainConflict: "Rahim must face the returning train.",
    mainCharacter: "Rahim",
    supportingCharacters: [],
    beginning: "Rahim closes the station for the final time.",
    middle: "A dead signal turns green in the darkness.",
    climax: "A vanished train rolls onto the platform.",
    ending: "The carriage door opens and calls his name.",
    audienceEmotion: "Uneasy curiosity",
    retentionMoments: [],
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  script: {
    id: "f09851fe-b88a-4aa0-a66c-fe41ec202f72",
    projectId,
    title: "The Last Train",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  scenes: [
    {
      id: "53df11bb-e5ae-480a-9868-fafc260988a8",
      projectId,
      scriptId: "f09851fe-b88a-4aa0-a66c-fe41ec202f72",
      position: 0,
      sceneNumber: 1,
      location: "Abandoned railway platform",
      timeOfDay: "Night",
      characters: ["Rahim"],
      action: "The signal wakes.",
      estimatedDurationSeconds: 4,
      emotionalPurpose: "Hook the audience",
      shots: [
        {
          id: "0cbdfce9-abcc-40bc-adc6-e7cc84b2207e",
          projectId,
          sceneId: "53df11bb-e5ae-480a-9868-fafc260988a8",
          position: 0,
          code: "SHOT_001",
          durationSeconds: 4,
          characters: ["Rahim"],
          props: ["Signal key"],
          location: "Abandoned railway platform",
          shotType: "wide",
          cameraAngle: "eye-level",
          lens: "35mm",
          cameraMovement: "slow-push-in",
          action: "The signal changes from red to green.",
          lighting: "Cold moonlight",
          emotion: "Unease",
          status: "draft",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  totals: { scenes: 1, shots: 1, shotDurationSeconds: 4 },
});

describe("buildReferenceCoverage", () => {
  it("resolves exact Bible records and composes a continuity prompt", () => {
    const bible = bibleSchema.parse({
      characters: [
        {
          id: "0c5a1a4e-b64d-4b30-ab1a-11f2498f96ad",
          projectId,
          code: "CHAR_RAHIM_001",
          name: "Rahim",
          age: 34,
          faceDescription: "Long face and a short trimmed beard",
          defaultClothing: ["beige shirt", "brown leather watch"],
          references: [
            {
              id: "e2065642-e434-4b7c-b259-5e2eb4708b10",
              projectId,
              ownerType: "character",
              ownerId: "0c5a1a4e-b64d-4b30-ab1a-11f2498f96ad",
              view: "front",
              originalFilename: "rahim.png",
              relativePath: "references/characters/rahim/front.png",
              mimeType: "image/png",
              byteSize: 128,
              sha256: "a".repeat(64),
              createdAt: timestamp,
            },
          ],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      locations: [
        {
          id: "60d4f379-3779-46a3-a5f8-d6939e96e0d8",
          projectId,
          code: "LOC_ABANDONED_RAILWAY_PLATFORM_001",
          name: "Abandoned railway platform",
          materials: ["weathered brick", "rusted steel"],
          references: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      props: [
        {
          id: "8981b98e-5f9a-4585-88e5-55397808873d",
          projectId,
          code: "PROP_SIGNAL_KEY_001",
          name: "Signal key",
          description: "A worn brass key on a red cord",
          references: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    const coverage = buildReferenceCoverage(project, plan, bible);
    expect(coverage.totals).toEqual({
      shots: 1,
      ready: 1,
      unresolved: 0,
      withoutImages: 2,
    });
    expect(coverage.shots[0]?.prompt).toContain("CHAR_RAHIM_001");
    expect(coverage.shots[0]?.prompt).toContain("weathered brick");
    expect(coverage.shots[0]?.prompt).toContain("worn brass key");
    expect(coverage.shots[0]?.prompt).toContain("rahim.png");
    expect(coverage.shots[0]?.prompt).toContain("ChatGPT Images or Gemini");
    expect(coverage.shots[0]?.prompt).toContain("9:16 aspect ratio");
    expect(coverage.shots[0]?.prompt).toContain("return a sharp still frame");
  });

  it("reports unresolved shot labels instead of guessing", () => {
    const coverage = buildReferenceCoverage(
      project,
      plan,
      bibleSchema.parse({ characters: [], locations: [], props: [] }),
    );
    expect(coverage.totals.ready).toBe(0);
    expect(coverage.totals.unresolved).toBe(3);
    expect(coverage.shots[0]?.unresolved.map((item) => item.value)).toEqual([
      "Rahim",
      "Abandoned railway platform",
      "Signal key",
    ]);
  });
});
