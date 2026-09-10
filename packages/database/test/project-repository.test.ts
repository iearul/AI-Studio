import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseManager } from "../src/database-manager.js";
import { ManifestOutboxRepository } from "../src/manifest-outbox-repository.js";
import { ProjectRepository } from "../src/project-repository.js";

const projectInput = {
  title: "The Last Train",
  type: "reel" as const,
  topic: "A silent train returns after twenty years.",
  language: "en" as const,
  targetDurationSeconds: 60,
  aspectRatio: "9:16" as const,
  style: "mystery" as const,
  narration: "narrator" as const,
};

describe("ProjectRepository", () => {
  let directory: string;
  let manager: DatabaseManager;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "film-studio-database-"));
    manager = new DatabaseManager(path.join(directory, "test.sqlite"));
    await manager.open();
  });

  afterEach(async () => {
    manager.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates, persists, filters, and updates a project", async () => {
    const repository = new ProjectRepository(manager);
    const created = repository.create(projectInput);

    expect(created.slug).toMatch(/^the-last-train-/);
    expect(repository.getById(created.id)).toEqual(created);
    expect(repository.list({ type: "video" })).toEqual([]);
    expect(repository.list({ search: "silent" })).toHaveLength(1);

    const updated = repository.update(created.id, {
      title: "The Last Train Home",
      status: "active",
    });
    expect(updated?.title).toBe("The Last Train Home");
    expect(updated?.status).toBe("active");
    expect(updated?.slug).toBe(created.slug);

    manager.close();
    manager = new DatabaseManager(path.join(directory, "test.sqlite"));
    await manager.open();
    expect(new ProjectRepository(manager).getById(created.id)?.title).toBe(
      "The Last Train Home",
    );
  });

  it("coalesces portable manifest work by project", () => {
    const projects = new ProjectRepository(manager);
    const outbox = new ManifestOutboxRepository(manager);
    const created = projects.create(projectInput);
    projects.update(created.id, { tone: "Ominous" });

    expect(outbox.count()).toBe(1);
    expect(outbox.list()[0]?.project.tone).toBe("Ominous");
  });
});
