import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { projectSchema } from "@ai-studio/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectManifestStore } from "../src/project-manifest-store.js";

describe("ProjectManifestStore", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "ai-studio-manifest-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes a portable versioned manifest atomically", async () => {
    const project = projectSchema.parse({
      id: "186a643e-4503-4c7f-83d8-d21596d0ad0a",
      slug: "the-last-train-186a643e",
      title: "The Last Train",
      type: "reel",
      topic: "A silent train returns after twenty years.",
      language: "en",
      targetDurationSeconds: 60,
      aspectRatio: "9:16",
      style: "mystery",
      narration: "narrator",
      status: "draft",
      createdAt: "2026-09-10T12:00:00.000Z",
      updatedAt: "2026-09-10T12:00:00.000Z",
    });
    const store = new ProjectManifestStore(directory);
    const file = await store.write(project);
    const manifest = JSON.parse(await readFile(file, "utf8")) as {
      projectVersion: number;
      project: { id: string };
    };

    expect(manifest.projectVersion).toBe(1);
    expect(manifest.project.id).toBe(project.id);
    expect(file.startsWith(directory)).toBe(true);
  });

  it("rejects identifiers that could escape the project root", () => {
    const store = new ProjectManifestStore(directory);
    expect(() => store.projectDirectory("../../secrets")).toThrow(
      "Invalid project identifier",
    );
  });
});
