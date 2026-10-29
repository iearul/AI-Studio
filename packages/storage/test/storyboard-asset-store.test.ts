import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  StoryboardAssetStore,
  StoryboardAssetValidationError,
} from "../src/storyboard-asset-store.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlT5ZkAAAAASUVORK5CYII=",
  "base64",
);
const projectId = "186a643e-4503-4c7f-83d8-d21596d0ad0a";
const shotId = "8ba8a4b6-834b-4071-9b02-d93415ac83d5";
const attemptId = "62559e64-8af3-4f87-a8b2-a52367445b57";

describe("StoryboardAssetStore", () => {
  let directory: string;
  let store: StoryboardAssetStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "ai-studio-assets-"));
    store = new StoryboardAssetStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("stores content-addressed metadata in the project boundary", async () => {
    const asset = await store.save({
      projectId,
      shotId,
      attemptId,
      originalFilename: "../frame.png",
      declaredMimeType: "image/png",
      buffer: png,
    });
    expect(asset).toMatchObject({
      originalFilename: "frame.png",
      mimeType: "image/png",
      width: 1,
      height: 1,
    });
    expect(asset.sha256).toHaveLength(64);
    expect(
      await readFile(store.absolutePath(projectId, asset.relativePath)),
    ).toEqual(png);
  });

  it("rejects spoofed content and traversal paths", async () => {
    await expect(
      store.save({
        projectId,
        shotId,
        attemptId,
        originalFilename: "frame.jpg",
        declaredMimeType: "image/jpeg",
        buffer: png,
      }),
    ).rejects.toThrow(StoryboardAssetValidationError);
    expect(() => store.absolutePath(projectId, "../../outside.png")).toThrow(
      StoryboardAssetValidationError,
    );
  });
});
