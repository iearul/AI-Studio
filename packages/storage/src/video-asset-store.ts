import { createHash } from "node:crypto";
import { open, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { VideoAsset } from "@ai-studio/contracts";

export const maximumVideoBytes = 512 * 1024 * 1024;

type StoredVideoAsset = {
  originalFilename: string;
  relativePath: string;
  mimeType: VideoAsset["mimeType"];
  byteSize: number;
  sha256: string;
};

type DetectedVideo = {
  family: "iso-bmff" | "webm";
  preferredMimeType: VideoAsset["mimeType"];
  extension: ".mp4" | ".mov" | ".webm";
};

function detectVideo(prefix: Buffer): DetectedVideo | undefined {
  if (
    prefix.length >= 4 &&
    prefix[0] === 0x1a &&
    prefix[1] === 0x45 &&
    prefix[2] === 0xdf &&
    prefix[3] === 0xa3
  ) {
    return {
      family: "webm",
      preferredMimeType: "video/webm",
      extension: ".webm",
    };
  }
  if (prefix.length >= 12 && prefix.toString("ascii", 4, 8) === "ftyp") {
    const quickTime = prefix.toString("ascii", 8, 12) === "qt  ";
    return {
      family: "iso-bmff",
      preferredMimeType: quickTime ? "video/quicktime" : "video/mp4",
      extension: quickTime ? ".mov" : ".mp4",
    };
  }
  return undefined;
}

function normalizeMimeType(value: string | undefined): string | undefined {
  return value?.split(";", 1)[0]?.trim().toLowerCase();
}

function selectFormat(
  detected: DetectedVideo,
  declaredMimeType: string | undefined,
): { mimeType: VideoAsset["mimeType"]; extension: string } {
  const declared = normalizeMimeType(declaredMimeType);
  if (!declared || declared === "application/octet-stream") {
    return {
      mimeType: detected.preferredMimeType,
      extension: detected.extension,
    };
  }
  if (detected.family === "webm" && declared !== "video/webm") {
    throw new VideoAssetValidationError(
      "The video contents do not match the declared file type.",
    );
  }
  if (
    detected.family === "iso-bmff" &&
    declared !== "video/mp4" &&
    declared !== "video/quicktime"
  ) {
    throw new VideoAssetValidationError(
      "The video contents do not match the declared file type.",
    );
  }
  if (declared === "video/quicktime") {
    return { mimeType: declared, extension: ".mov" };
  }
  if (declared === "video/mp4") {
    return { mimeType: declared, extension: ".mp4" };
  }
  return { mimeType: "video/webm", extension: ".webm" };
}

export class VideoAssetStore {
  constructor(private readonly projectsRoot: string) {}

  async save(input: {
    projectId: string;
    shotId: string;
    attemptId: string;
    originalFilename: string;
    declaredMimeType?: string;
    stream: AsyncIterable<Uint8Array>;
    maximumBytes?: number;
  }): Promise<StoredVideoAsset> {
    this.assertUuid(input.projectId, "project");
    this.assertUuid(input.shotId, "shot");
    this.assertUuid(input.attemptId, "attempt");
    const maximumBytes = input.maximumBytes ?? maximumVideoBytes;
    const directory = this.absoluteDirectory(input.projectId, input.shotId);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(
      directory,
      `.${input.attemptId}.${process.pid}.upload`,
    );
    const handle = await open(temporary, "wx", 0o600);
    const hash = createHash("sha256");
    let byteSize = 0;
    let prefix = Buffer.alloc(0);
    try {
      for await (const value of input.stream) {
        const chunk = Buffer.from(value);
        byteSize += chunk.length;
        if (byteSize > maximumBytes) {
          throw new VideoAssetValidationError(
            `Videos may be at most ${Math.floor(maximumBytes / 1024 / 1024)} MB.`,
          );
        }
        if (prefix.length < 16) {
          prefix = Buffer.concat([
            prefix,
            chunk.subarray(0, 16 - prefix.length),
          ]);
        }
        hash.update(chunk);
        let offset = 0;
        const position = byteSize - chunk.length;
        while (offset < chunk.length) {
          const { bytesWritten } = await handle.write(
            chunk,
            offset,
            chunk.length - offset,
            position + offset,
          );
          if (bytesWritten === 0) {
            throw new Error("The video upload could not be written to disk.");
          }
          offset += bytesWritten;
        }
      }
      if (byteSize === 0) {
        throw new VideoAssetValidationError("The video is empty.");
      }
      const detected = detectVideo(prefix);
      if (!detected) {
        throw new VideoAssetValidationError(
          "Shot videos must be MP4, MOV, or WebM files.",
        );
      }
      const format = selectFormat(detected, input.declaredMimeType);
      await handle.close();
      const relativePath = path.posix.join(
        "videos",
        input.shotId,
        `${input.attemptId}${format.extension}`,
      );
      await rename(temporary, this.absolutePath(input.projectId, relativePath));
      return {
        originalFilename: safeMediaFilename(input.originalFilename),
        relativePath,
        mimeType: format.mimeType,
        byteSize,
        sha256: hash.digest("hex"),
      };
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true });
      throw error;
    }
  }

  absolutePath(projectId: string, relativePath: string): string {
    this.assertUuid(projectId, "project");
    if (path.isAbsolute(relativePath)) {
      throw new VideoAssetValidationError("Invalid video path.");
    }
    if (relativePath.split(/[\\/]/, 1)[0] !== "videos") {
      throw new VideoAssetValidationError("Invalid video path.");
    }
    const projectRoot = path.resolve(this.projectsRoot, projectId);
    const destination = path.resolve(projectRoot, relativePath);
    const relative = path.relative(projectRoot, destination);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new VideoAssetValidationError("Invalid video path.");
    }
    return destination;
  }

  async remove(projectId: string, relativePath: string): Promise<void> {
    await rm(this.absolutePath(projectId, relativePath), { force: true });
  }

  private absoluteDirectory(projectId: string, shotId: string): string {
    return path.dirname(
      this.absolutePath(
        projectId,
        path.posix.join("videos", shotId, "placeholder.mp4"),
      ),
    );
  }

  private assertUuid(value: string, resource: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(value)) {
      throw new VideoAssetValidationError(`Invalid ${resource} identifier.`);
    }
  }
}

function safeMediaFilename(filename: string): string {
  const basename = Array.from(path.basename(filename))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  return basename.slice(0, 255) || "video";
}

export class VideoAssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoAssetValidationError";
  }
}
