import { bibleSchema, projectSchema } from "@ai-studio/contracts";
import { describe, expect, it } from "vitest";

import { buildReferencePrompt } from "../src/reference-prompt.js";

const timestamp = "2026-10-11T12:00:00.000Z";
const projectId = "186a643e-4503-4c7f-83d8-d21596d0ad0a";
const locationId = "6f4b3a52-6d2c-4bb8-9c4b-0a3e3f9a8b11";
const propId = "9d1e2f34-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
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
const bible = bibleSchema.parse({
  characters: [],
  locations: [
    {
      id: locationId,
      projectId,
      code: "LOC_ABANDONED_PLATFORM_001",
      name: "Abandoned platform",
      type: "Rural railway platform",
      description: "A narrow concrete platform beside a single track",
      architecture: "Colonial-era brick station house with a tin roof",
      materials: ["cracked concrete", "rusted iron"],
      colorPalette: ["faded green", "rust"],
      defaultLighting: "Single sodium lamp and moonlight",
      references: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  props: [
    {
      id: propId,
      projectId,
      code: "PROP_SIGNAL_LANTERN_001",
      name: "Signal lantern",
      description: "Hand-held railway lantern with a green glass lens",
      significance: "It turns green when the lost train arrives",
      references: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
});

describe("buildReferencePrompt", () => {
  it("builds an empty, wide location reference from the Bible record", () => {
    const result = buildReferencePrompt(
      project,
      bible,
      "location",
      locationId,
      "exterior-night",
    );

    expect(result).toMatchObject({
      ownerType: "location",
      ownerId: locationId,
      ownerName: "Abandoned platform",
      view: "exterior-night",
      filename: "abandoned-platform-exterior-night-reference.png",
      ready: true,
      missingDetails: [],
    });
    expect(result?.prompt).toContain(
      "- Architecture: Colonial-era brick station house with a tin roof",
    );
    expect(result?.prompt).toContain("Landscape 16:9 composition");
    expect(result?.prompt).toContain("- Single sodium lamp and moonlight");
    expect(result?.prompt).toContain("People, crowds, animals, or vehicles");
  });

  it("builds a square prop reference and lists the missing details", () => {
    const result = buildReferencePrompt(project, bible, "prop", propId);

    expect(result).toMatchObject({
      ownerType: "prop",
      ownerCode: "PROP_SIGNAL_LANTERN_001",
      view: "three-quarter",
      ready: false,
      missingDetails: ["materials", "colors"],
    });
    expect(result?.prompt).toContain("Square 1:1 composition");
    expect(result?.prompt).toContain(
      "- Story role (do not illustrate it): It turns green when the lost train arrives",
    );
    expect(result?.prompt).toContain(
      "Choose natural, understated values for materials, colors",
    );
  });

  it("returns undefined for a record outside the project", () => {
    expect(
      buildReferencePrompt(project, bible, "character", locationId),
    ).toBeUndefined();
  });
});
