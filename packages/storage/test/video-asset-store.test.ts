import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  VideoAssetStore,
  VideoAssetValidationError,
} from "../src/video-asset-store.js";

const projectId = "00000000-0000-4000-8000-000000000001";
const shotId = "00000000-0000-4000-8000-000000000002";
const attemptId = "00000000-0000-4000-8000-000000000003";
const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.from("0000000000000000", "ascii"),
]);

function chunks(buffer: Buffer): Readable {
  return Readable.from([buffer.subarray(0, 7), buffer.subarray(7)]);
}

describe("VideoAssetStore", () => {
  let directory: string;
  let store: VideoAssetStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "film-studio-videos-"));
    store = new VideoAssetStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("streams an MP4 into a contained immutable path", async () => {
    const asset = await store.save({
      projectId,
      shotId,
      attemptId,
      originalFilename: "shot.mp4",
      declaredMimeType: "video/mp4",
      stream: chunks(mp4),
    });
    expect(asset.relativePath).toBe(`videos/${shotId}/${attemptId}.mp4`);
    expect(
      await readFile(store.absolutePath(projectId, asset.relativePath)),
    ).toEqual(mp4);
  });

  it("rejects spoofed content and removes the temporary upload", async () => {
    await expect(
      store.save({
        projectId,
        shotId,
        attemptId,
        originalFilename: "shot.mp4",
        declaredMimeType: "video/mp4",
        stream: chunks(Buffer.from("not a video")),
      }),
    ).rejects.toBeInstanceOf(VideoAssetValidationError);
  });
});
