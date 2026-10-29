import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AudioRepository } from "../src/audio-repository.js";
import { DatabaseManager } from "../src/database-manager.js";
import { GenerationStateError } from "../src/generation-repository.js";
import { ProjectRepository } from "../src/project-repository.js";

describe("AudioRepository", () => {
  let directory: string;
  let manager: DatabaseManager;
  let repository: AudioRepository;
  let projectId: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "ai-studio-audio-"));
    manager = new DatabaseManager(path.join(directory, "test.sqlite"));
    await manager.open();
    const projects = new ProjectRepository(manager);
    projectId = projects.create({
      title: "The Last Train",
      type: "reel",
      topic: "A lost train returns.",
      language: "bn",
      targetDurationSeconds: 30,
      aspectRatio: "9:16",
      style: "mystery",
      narration: "narrator",
    }).id;
    repository = new AudioRepository(manager, projects);
  });

  afterEach(async () => {
    manager.close();
    await rm(directory, { recursive: true, force: true });
  });

  function music() {
    return repository.begin({
      projectId,
      kind: "music",
      targetKey: "music:project",
      sceneId: null,
      shotId: null,
      model: "music_v2_5",
      text: "Tense strings",
      settings: {},
    });
  }

  it("keeps one narrator profile and replaces its voice", () => {
    repository.saveVoiceProfile(projectId, {
      role: "narrator",
      characterId: null,
      voiceId: "voice-a",
      voiceName: "Voice A",
    });
    const updated = repository.saveVoiceProfile(projectId, {
      role: "narrator",
      characterId: null,
      voiceId: "voice-b",
      voiceName: "Voice B",
    });

    expect(repository.listVoiceProfiles(projectId)).toEqual([updated]);
    expect(updated).toMatchObject({ voiceId: "voice-b", role: "narrator" });
  });

  it("allows one active take per target and fails interrupted takes", () => {
    const first = music();
    expect(() => music()).toThrow(GenerationStateError);

    expect(repository.failInterrupted()).toBe(1);
    expect(repository.getAttempt(projectId, first.id)).toMatchObject({
      status: "failed",
      errorMessage: expect.stringContaining("Interrupted") as unknown,
    });
    expect(music().status).toBe("generating");
  });

  it("records the file and cost of a finished take", () => {
    const take = music();
    const done = repository.complete(
      projectId,
      take.id,
      {
        relativePath: `audio/music/${take.id}.mp3`,
        mimeType: "audio/mpeg",
        byteSize: 2048,
        sha256: "d".repeat(64),
      },
      30_000,
      75_000,
    );

    expect(done).toMatchObject({
      status: "succeeded",
      costMicros: 75_000,
      asset: { mimeType: "audio/mpeg", byteSize: 2048 },
    });
    expect(repository.review(projectId, take.id, "approve").selected).toBe(
      true,
    );
  });
});
