import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AudioProviderStatus, Voice } from "@ai-film-studio/contracts";
import type {
  AudioProvider,
  DialogueTurn,
  GeneratedAudio,
} from "@ai-film-studio/providers";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createServices, type Services } from "../src/services.js";

const mp3 = Buffer.concat([
  Buffer.from("ID3"),
  Buffer.from([0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  Buffer.alloc(32, 1),
]);
const confirmation = { confirmation: "I AUTHORIZE THIS PAID GENERATION" };

class FakeAudioProvider implements AudioProvider {
  readonly id = "elevenlabs" as const;
  readonly speechCalls: Array<{ voiceId: string; text: string }> = [];
  readonly dialogueCalls: DialogueTurn[][] = [];
  readonly effectPrompts: string[] = [];

  status(): AudioProviderStatus {
    return {
      id: this.id,
      label: "Fake ElevenLabs",
      configured: true,
      message: "Ready",
      speechModel: "eleven_v4",
      soundEffectModel: "eleven_text_to_sound_v2",
      musicModel: "music_v2_5",
      estimatedUsd: {
        speechPer1kCharacters: 0.08,
        soundEffectPerMinute: 0.12,
        musicPerMinute: 0.15,
      },
    };
  }

  listVoices(): Promise<Voice[]> {
    return Promise.resolve([]);
  }

  speech(input: { voiceId: string; text: string }): Promise<GeneratedAudio> {
    this.speechCalls.push(input);
    return this.result("eleven_v4", 1_000);
  }

  dialogue(input: { turns: DialogueTurn[] }): Promise<GeneratedAudio> {
    this.dialogueCalls.push(input.turns);
    return this.result("eleven_v4", 2_000);
  }

  soundEffect(input: { prompt: string }): Promise<GeneratedAudio> {
    this.effectPrompts.push(input.prompt);
    return this.result("eleven_text_to_sound_v2", 8_000);
  }

  music(): Promise<GeneratedAudio> {
    return this.result("music_v2_5", 75_000);
  }

  private result(model: string, costMicros: number): Promise<GeneratedAudio> {
    return Promise.resolve({ data: mp3, model, costMicros });
  }
}

describe("sound API", () => {
  let directory: string;
  let services: Services;
  let app: FastifyInstance;
  let provider: FakeAudioProvider;
  let projectId: string;
  let sceneId: string;
  let shotId: string;
  let characterId: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "film-studio-audio-api-"));
    process.env.DATABASE_PATH = path.join(directory, "film-studio.sqlite");
    process.env.PROJECTS_PATH = path.join(directory, "projects");
    process.env.BACKUPS_PATH = path.join(directory, "backups");
    process.env.CACHE_PATH = path.join(directory, "cache");
    provider = new FakeAudioProvider();
    services = await createServices({ audioProvider: provider });
    app = await buildApp(
      {
        environment: "test",
        host: "127.0.0.1",
        port: 4100,
        webOrigins: new Set(["http://localhost:3000"]),
      },
      services,
    );
    projectId = (
      await app.inject({
        method: "POST",
        url: "/api/v1/projects",
        payload: {
          title: "The Last Train",
          type: "reel",
          topic: "A lost train returns.",
          language: "bn",
          targetDurationSeconds: 30,
          aspectRatio: "9:16",
          style: "mystery",
          narration: "both",
        },
      })
    ).json<{ id: string }>().id;
    const plan = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/story-plan`,
      payload: {
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
            location: "Abandoned platform",
            timeOfDay: "Night",
            characters: ["Rahim"],
            action: "A signal wakes.",
            narration: "No train was due after midnight.",
            dialogue: "Rahim: Who is there?",
            estimatedDurationSeconds: 4,
            emotionalPurpose: "Hook",
            shots: [
              {
                code: "SHOT_001",
                durationSeconds: 4,
                characters: ["Rahim"],
                location: "Abandoned platform",
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
      },
    });
    const scene = plan.json<{
      scenes: Array<{ id: string; shots: Array<{ id: string }> }>;
    }>().scenes[0]!;
    sceneId = scene.id;
    shotId = scene.shots[0]!.id;
    characterId = services.bible.list(projectId).characters[0]!.id;
  });

  afterEach(async () => {
    await services.audioGenerations.settle();
    await app.close();
    services.database.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function saveVoice(role: string, character: string | null) {
    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/voice-profiles`,
      payload: {
        role,
        characterId: character,
        voiceId: `voice-${role}`,
        voiceName: `${role} voice`,
      },
    });
    expect(response.statusCode).toBe(200);
  }

  it("shows scene narration, speaker-labelled dialogue, and missing voices", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/sound-workspace`,
    });
    expect(response.json()).toMatchObject({
      languageCode: "bn",
      narrator: null,
      characters: [{ characterId, name: "Rahim", profile: null }],
      scenes: [
        {
          sceneId,
          narration: { text: "No train was due after midnight." },
          dialogue: {
            lines: [{ speaker: "Rahim", characterId, text: "Who is there?" }],
            missingVoices: ["Rahim"],
          },
          shots: [{ shotId, soundEffects: { durationSeconds: 4 } }],
        },
      ],
    });
  });

  it("generates narration with the narrator voice and serves it with byte ranges", async () => {
    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/scenes/${sceneId}/narration-generations`,
      payload: confirmation,
    });
    expect(blocked.statusCode).toBe(409);

    await saveVoice("narrator", null);
    const started = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/scenes/${sceneId}/narration-generations`,
      payload: confirmation,
    });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({
      kind: "narration",
      status: "generating",
    });
    await services.audioGenerations.settle();

    const [attempt] = services.audio.listProject(projectId);
    expect(attempt).toMatchObject({
      status: "succeeded",
      costMicros: 1_000,
      targetKey: `narration:${sceneId}`,
    });
    expect(provider.speechCalls).toEqual([
      {
        voiceId: "voice-narrator",
        text: "No train was due after midnight.",
        languageCode: "bn",
      },
    ]);

    const partial = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/audio-attempts/${attempt!.id}/content`,
      headers: { range: "bytes=0-2" },
    });
    expect(partial.statusCode).toBe(206);
    expect(partial.headers["content-type"]).toBe("audio/mpeg");
    expect(partial.rawPayload.toString()).toBe("ID3");
  });

  it("requires every speaker's voice before generating dialogue", async () => {
    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/scenes/${sceneId}/dialogue-generations`,
      payload: confirmation,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ detail: string }>().detail).toContain("Rahim");

    await saveVoice("character", characterId);
    const started = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/scenes/${sceneId}/dialogue-generations`,
      payload: confirmation,
    });
    expect(started.statusCode).toBe(202);
    await services.audioGenerations.settle();
    expect(provider.dialogueCalls).toEqual([
      [{ voiceId: "voice-character", text: "Who is there?" }],
    ]);
  });

  it("generates shot effects and approves one music take at a time", async () => {
    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/sound-effect-generations`,
      payload: confirmation,
    });
    for (let take = 0; take < 2; take++) {
      await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/music-generations`,
        payload: confirmation,
      });
      await services.audioGenerations.settle();
    }
    expect(provider.effectPrompts[0]).toContain("The signal turns green.");

    const music = services.audio
      .listProject(projectId)
      .filter((attempt) => attempt.kind === "music");
    expect(music).toHaveLength(2);
    for (const take of music) {
      const review = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/audio-attempts/${take.id}/review`,
        payload: { decision: "approve" },
      });
      expect(review.statusCode).toBe(200);
    }
    const selected = services.audio
      .listProject(projectId)
      .filter((attempt) => attempt.kind === "music" && attempt.selected);
    expect(selected.map((attempt) => attempt.id)).toEqual([music[1]!.id]);
  });

  it("refuses paid generation without the confirmation", async () => {
    await saveVoice("narrator", null);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/scenes/${sceneId}/narration-generations`,
      payload: {},
    });
    expect(response.statusCode).toBe(422);
    expect(provider.speechCalls).toHaveLength(0);
  });
});
