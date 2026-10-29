import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ReferenceOwnerType } from "@ai-studio/contracts";

export type SupportedImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: ".jpg" | ".png" | ".webp";
};

export type StoredReferenceImage = SupportedImage & {
  originalFilename: string;
  relativePath: string;
  byteSize: number;
  sha256: string;
};

export function detectImage(buffer: Buffer): SupportedImage | undefined {
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mimeType: "image/png", extension: ".png" };
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mimeType: "image/jpeg", extension: ".jpg" };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: ".webp" };
  }
  return undefined;
}

export class ReferenceImageStore {
  constructor(private readonly projectsRoot: string) {}

  async save(input: {
    projectId: string;
    ownerType: ReferenceOwnerType;
    ownerId: string;
    originalFilename: string;
    declaredMimeType: string;
    buffer: Buffer;
  }): Promise<StoredReferenceImage> {
    if (input.buffer.length === 0) {
      throw new ReferenceImageValidationError("The uploaded image is empty.");
    }
    const detected = detectImage(input.buffer);
    if (!detected) {
      throw new ReferenceImageValidationError(
        "Reference images must be JPEG, PNG, or WebP files.",
      );
    }
    if (input.declaredMimeType !== detected.mimeType) {
      throw new ReferenceImageValidationError(
        "The image contents do not match the declared file type.",
      );
    }
    const relativePath = path.posix.join(
      "references",
      `${input.ownerType}s`,
      input.ownerId,
      `${randomUUID()}${detected.extension}`,
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
    return {
      ...detected,
      originalFilename: safeImageFilename(input.originalFilename),
      relativePath,
      byteSize: input.buffer.length,
      sha256: createHash("sha256").update(input.buffer).digest("hex"),
    };
  }

  absolutePath(projectId: string, relativePath: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
      throw new ReferenceImageValidationError("Invalid project identifier.");
    }
    if (path.isAbsolute(relativePath)) {
      throw new ReferenceImageValidationError("Invalid reference image path.");
    }
    const firstSegment = relativePath.split(/[\\/]/, 1)[0];
    if (firstSegment !== "references") {
      throw new ReferenceImageValidationError("Invalid reference image path.");
    }
    const projectRoot = path.resolve(this.projectsRoot, projectId);
    const destination = path.resolve(projectRoot, relativePath);
    const relative = path.relative(projectRoot, destination);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ReferenceImageValidationError("Invalid reference image path.");
    }
    return destination;
  }

  async remove(projectId: string, relativePath: string): Promise<void> {
    await rm(this.absolutePath(projectId, relativePath), { force: true });
  }
}

export function safeImageFilename(filename: string): string {
  const basename = Array.from(path.basename(filename))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  return basename.slice(0, 255) || "image";
}

export class ReferenceImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceImageValidationError";
  }
}
