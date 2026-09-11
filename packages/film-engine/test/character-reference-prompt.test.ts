import { bibleSchema, projectSchema } from "@ai-film-studio/contracts";
import { describe, expect, it } from "vitest";

import { buildCharacterReferencePrompt } from "../src/character-reference-prompt.js";

const timestamp = "2026-09-11T12:00:00.000Z";
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
  countryCulture: "Bangladesh",
  visualStyle: "Naturalistic 35mm night photography",
  status: "draft",
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe("buildCharacterReferencePrompt", () => {
  it("uses structured identity details and production-safe constraints", () => {
    const character = bibleSchema.parse({
      characters: [
        {
          id: "0c5a1a4e-b64d-4b30-ab1a-11f2498f96ad",
          projectId,
          code: "CHAR_RAHIM_001",
          name: "Rahim",
          age: 34,
          gender: "man",
          culturalAppearance: "Bangladeshi",
          faceDescription: "Long face with a short trimmed beard",
          hair: "short, black, slightly wavy",
          eyes: "dark brown",
          skin: "medium-brown with natural texture",
          height: "178 cm",
          bodyType: "lean",
          defaultClothing: ["beige cotton shirt", "dark trousers"],
          accessories: ["brown leather watch"],
          personality: "quiet and observant",
          references: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      locations: [],
      props: [],
    }).characters[0]!;

    const result = buildCharacterReferencePrompt(project, character);
    expect(result.ready).toBe(true);
    expect(result.filename).toBe("rahim-master-reference.png");
    expect(result.prompt).toContain("CHAR_RAHIM_001");
    expect(result.prompt).toContain("Long face with a short trimmed beard");
    expect(result.prompt).toContain("brown leather watch");
    expect(result.prompt).toContain("Exactly one person");
    expect(result.prompt).toContain("50mm full-frame lens");
    expect(result.prompt).toContain("extra fingers");
  });

  it("reports details that should be completed before generation", () => {
    const character = bibleSchema.parse({
      characters: [
        {
          id: "0c5a1a4e-b64d-4b30-ab1a-11f2498f96ad",
          projectId,
          code: "CHAR_RAHIM_001",
          name: "Rahim",
          references: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      locations: [],
      props: [],
    }).characters[0]!;

    const result = buildCharacterReferencePrompt(project, character);
    expect(result.ready).toBe(false);
    expect(result.missingDetails).toEqual([
      "face description",
      "hair",
      "eyes",
      "skin tone and texture",
      "body type",
      "default clothing",
    ]);
    expect(result.prompt).toContain("UNSPECIFIED DETAILS");
  });
});
