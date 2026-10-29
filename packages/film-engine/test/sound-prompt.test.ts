import { bibleSchema } from "@ai-studio/contracts";
import { describe, expect, it } from "vitest";

import {
  buildSoundEffectPrompt,
  parseDialogue,
  soundEffectDuration,
} from "../src/sound-prompt.js";

const timestamp = "2026-10-11T12:00:00.000Z";
const projectId = "186a643e-4503-4c7f-83d8-d21596d0ad0a";
const rahimId = "0c5a1a4e-b64d-4b30-ab1a-11f2498f96ad";
const miraId = "1d6b2b5f-c75e-4c41-bc2b-22a3509a07be";
const characters = bibleSchema.parse({
  characters: [
    {
      id: rahimId,
      projectId,
      code: "CHAR_RAHIM_001",
      name: "Rahim",
      references: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: miraId,
      projectId,
      code: "CHAR_MIRA_001",
      name: "Mira",
      references: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  locations: [],
  props: [],
}).characters;

describe("parseDialogue", () => {
  it("assigns labelled lines to Bible characters by name or code", () => {
    expect(
      parseDialogue(
        {
          characters: ["Rahim", "Mira"],
          dialogue: 'Rahim: "Who is there?"\nCHAR_MIRA_001: Only the wind.',
        },
        characters,
      ),
    ).toEqual([
      { speaker: "Rahim", characterId: rahimId, text: "Who is there?" },
      { speaker: "Mira", characterId: miraId, text: "Only the wind." },
    ]);
  });

  it("gives unlabelled lines and unknown labels to the scene's first character", () => {
    expect(
      parseDialogue(
        {
          characters: ["Mira"],
          dialogue: "Who is there?\nNote: the lamp is out.",
        },
        characters,
      ),
    ).toEqual([
      { speaker: "Mira", characterId: miraId, text: "Who is there?" },
      { speaker: "Mira", characterId: miraId, text: "Note: the lamp is out." },
    ]);
  });

  it("keeps a speaker without a Bible record visible with no character id", () => {
    expect(
      parseDialogue(
        { characters: [], dialogue: "Stationmaster: Last train has gone." },
        characters,
      ),
    ).toEqual([
      {
        speaker: "Stationmaster",
        characterId: null,
        text: "Last train has gone.",
      },
    ]);
    expect(
      parseDialogue({ characters: [], dialogue: null }, characters),
    ).toEqual([]);
  });
});

describe("sound effect prompts", () => {
  it("describes diegetic sound for the shot and caps the length", () => {
    const prompt = buildSoundEffectPrompt(
      { timeOfDay: "Night" },
      {
        action: "The signal turns green.",
        location: "Abandoned platform",
        emotion: "Unease",
      },
    );
    expect(prompt).toContain("The signal turns green.");
    expect(prompt).toContain("Setting: Abandoned platform, Night.");
    expect(prompt).toContain("No music, no speech, no voices.");
    expect(soundEffectDuration({ durationSeconds: 45 })).toBe(30);
  });
});
