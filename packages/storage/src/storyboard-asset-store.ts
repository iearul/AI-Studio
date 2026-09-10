import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  detectImage,
  ReferenceImageValidationError,
  safeImageFilename,
} from "./reference-image-store.js";

export type StoredStoryboardAsset = {
  originalFilename: string;
  relativePath: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
};

export class StoryboardAssetStore {
  constructor(private readonly projectsRoot: string) {}

  async save(input: {
    projectId: string;
    shotId: string;
    attemptId: string;
    originalFilename: string;
    declaredMimeType?: string;
    buffer: Buffer;
  }): Promise<StoredStoryboardAsset> {
    if (input.buffer.length === 0) {
      throw new StoryboardAssetValidationError("The image is empty.");
    }
    const detected = detectImage(input.buffer);
    if (!detected) {
      throw new StoryboardAssetValidationError(
        "Storyboard images must be JPEG, PNG, or WebP files.",
      );
    }
    if (
      input.declaredMimeType &&
      input.declaredMimeType !== "application/octet-stream" &&
      input.declaredMimeType !== detected.mimeType
    ) {
      throw new StoryboardAssetValidationError(
        "The image contents do not match the declared file type.",
      );
    }
    this.assertUuid(input.shotId, "shot");
    this.assertUuid(input.attemptId, "attempt");
    const relativePath = path.posix.join(
      "storyboard",
      input.shotId,
      `${input.attemptId}${detected.extension}`,
    );
    const destination = this.absolutePath(input.projectId, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, input.buffer, { flag: "wx", mode: 0o600 });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    const dimensions = imageDimensions(input.buffer, detected.mimeType);
    return {
      originalFilename: safeImageFilename(input.originalFilename),
      relativePath,
      mimeType: detected.mimeType,
      byteSize: input.buffer.length,
      sha256: createHash("sha256").update(input.buffer).digest("hex"),
      ...dimensions,
    };
  }

  absolutePath(projectId: string, relativePath: string): string {
    this.assertUuid(projectId, "project");
    if (path.isAbsolute(relativePath)) {
      throw new StoryboardAssetValidationError("Invalid storyboard path.");
    }
    if (relativePath.split(/[\\/]/, 1)[0] !== "storyboard") {
      throw new StoryboardAssetValidationError("Invalid storyboard path.");
    }
    const projectRoot = path.resolve(this.projectsRoot, projectId);
    const destination = path.resolve(projectRoot, relativePath);
    const relative = path.relative(projectRoot, destination);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new StoryboardAssetValidationError("Invalid storyboard path.");
    }
    return destination;
  }

  async remove(projectId: string, relativePath: string): Promise<void> {
    await rm(this.absolutePath(projectId, relativePath), { force: true });
  }

  private assertUuid(value: string, resource: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(value)) {
      throw new StoryboardAssetValidationError(
        `Invalid ${resource} identifier.`,
      );
    }
  }
}

function imageDimensions(
  buffer: Buffer,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
): { width: number | null; height: number | null } {
  if (mimeType === "image/png" && buffer.length >= 24) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0
      ? { width, height }
      : { width: null, height: null };
  }
  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      if (marker === undefined) break;
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > buffer.length) break;
      if (marker >= 0xc0 && marker <= 0xc3 && length >= 7) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += length + 2;
    }
  }
  return { width: null, height: null };
}

export class StoryboardAssetValidationError extends ReferenceImageValidationError {
  constructor(message: string) {
    super(message);
    this.name = "StoryboardAssetValidationError";
  }
}
