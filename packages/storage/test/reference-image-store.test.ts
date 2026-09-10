import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ReferenceImageStore,
  ReferenceImageValidationError,
} from "../src/reference-image-store.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlT5ZkAAAAASUVORK5CYII=",
  "base64",
);
const projectId = "186a643e-4503-4c7f-83d8-d21596d0ad0a";
const ownerId = "8ba8a4b6-834b-4071-9b02-d93415ac83d5";

describe("ReferenceImageStore", () => {
  let directory: string;
  let store: ReferenceImageStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "film-studio-references-"));
    store = new ReferenceImageStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("detects, hashes, and stores a project-contained image", async () => {
    const saved = await store.save({
      projectId,
      ownerType: "character",
      ownerId,
      originalFilename: "../rahim.png",
      declaredMimeType: "image/png",
      buffer: png,
    });

    expect(saved.mimeType).toBe("image/png");
    expect(saved.originalFilename).toBe("rahim.png");
    expect(saved.sha256).toHaveLength(64);
    expect(saved.relativePath).toMatch(/^references\/characters\//);
    expect(
      await readFile(store.absolutePath(projectId, saved.relativePath)),
    ).toEqual(png);
  });

  it("rejects spoofed image types and path traversal", async () => {
    await expect(
      store.save({
        projectId,
        ownerType: "character",
        ownerId,
        originalFilename: "rahim.jpg",
        declaredMimeType: "image/jpeg",
        buffer: png,
      }),
    ).rejects.toThrow(ReferenceImageValidationError);
    expect(() => store.absolutePath(projectId, "../../secret.png")).toThrow(
      ReferenceImageValidationError,
    );
    expect(() => store.absolutePath(projectId, "project.json")).toThrow(
      ReferenceImageValidationError,
    );
  });
});
