import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BibleConflictError,
  BibleEntityNotFoundError,
  BibleRepository,
} from "../src/bible-repository.js";
import { DatabaseManager } from "../src/database-manager.js";
import { ManifestOutboxRepository } from "../src/manifest-outbox-repository.js";
import { ProjectRepository } from "../src/project-repository.js";

describe("BibleRepository", () => {
  let directory: string;
  let manager: DatabaseManager;
  let projects: ProjectRepository;
  let bible: BibleRepository;
  let projectId: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "film-studio-bible-"));
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
    bible = new BibleRepository(manager, projects);
  });

  afterEach(async () => {
    manager.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates stable character, location, and prop records", () => {
    const character = bible.createCharacter(projectId, {
      name: "Rahim",
      age: 34,
      faceDescription: "Long face with a short trimmed beard",
      defaultClothing: ["beige shirt", "brown leather watch"],
    });
    const location = bible.createLocation(projectId, {
      name: "Abandoned railway platform",
      type: "Rural railway station",
      materials: ["weathered brick", "rusted steel"],
    });
    const prop = bible.createProp(projectId, {
      name: "Signal key",
      description: "A worn brass key on a red cord",
    });

    expect(character.code).toBe("CHAR_RAHIM_001");
    expect(location.code).toBe("LOC_ABANDONED_RAILWAY_PLATFORM_001");
    expect(prop.code).toBe("PROP_SIGNAL_KEY_001");
    expect(bible.list(projectId).characters[0]?.defaultClothing).toContain(
      "beige shirt",
    );
    expect(new ManifestOutboxRepository(manager).count()).toBe(1);
    expect(() => bible.createCharacter(projectId, { name: "rahim" })).toThrow(
      BibleConflictError,
    );
  });

  it("attaches validated reference metadata only to owners in the project", () => {
    const character = bible.createCharacter(projectId, { name: "Rahim" });
    const reference = bible.addReference(projectId, {
      ownerType: "character",
      ownerId: character.id,
      view: "front",
      originalFilename: "rahim.png",
      relativePath: `references/characters/${character.id}/image.png`,
      mimeType: "image/png",
      byteSize: 128,
      sha256: "a".repeat(64),
    });

    expect(bible.list(projectId).characters[0]?.references[0]?.id).toBe(
      reference.id,
    );
    expect(() =>
      bible.addReference(projectId, {
        ownerType: "character",
        ownerId: "186a643e-4503-4c7f-83d8-d21596d0ad0a",
        view: "profile",
        originalFilename: "unknown.png",
        relativePath: "references/characters/unknown/image.png",
        mimeType: "image/png",
        byteSize: 128,
        sha256: "b".repeat(64),
      }),
    ).toThrow(BibleEntityNotFoundError);
  });
});
