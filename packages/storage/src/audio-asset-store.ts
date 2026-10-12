import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AudioKind } from "@ai-film-studio/contracts";

import { ReferenceImageValidationError } from "./reference-image-store.js";

export type StoredAudioAsset = {
  relativePath: string;
  mimeType: "audio/mpeg";
  byteSize: number;
  sha256: string;
};

/** Recognizes MP3 data by its ID3 tag or an MPEG audio frame header. */
export function isMp3(buffer: Buffer): boolean {
  if (buffer.length < 3) return false;
  if (buffer.toString("latin1", 0, 3) === "ID3") return true;
  const second = buffer[1] ?? 0;
  return buffer[0] === 0xff && (second & 0xe0) === 0xe0;
}

export class AudioAssetStore {
  constructor(private readonly projectsRoot: string) {}

  async save(input: {
    projectId: string;
    attemptId: string;
    kind: AudioKind;
    buffer: Buffer;
  }): Promise<StoredAudioAsset> {
    if (!isMp3(input.buffer)) {
      throw new AudioAssetValidationError(
        "The provider did not return MP3 audio.",
      );
    }
    this.assertUuid(input.attemptId, "attempt");
    const relativePath = path.posix.join(
      "audio",
      input.kind,
      `${input.attemptId}.mp3`,
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
      relativePath,
      mimeType: "audio/mpeg",
      byteSize: input.buffer.length,
      sha256: createHash("sha256").update(input.buffer).digest("hex"),
    };
  }

  absolutePath(projectId: string, relativePath: string): string {
    this.assertUuid(projectId, "project");
    if (
      path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/, 1)[0] !== "audio"
    ) {
      throw new AudioAssetValidationError("Invalid audio path.");
    }
    const projectRoot = path.resolve(this.projectsRoot, projectId);
    const destination = path.resolve(projectRoot, relativePath);
    const relative = path.relative(projectRoot, destination);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new AudioAssetValidationError("Invalid audio path.");
    }
    return destination;
  }

  async remove(projectId: string, relativePath: string): Promise<void> {
    await rm(this.absolutePath(projectId, relativePath), { force: true });
  }

  private assertUuid(value: string, resource: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(value)) {
      throw new AudioAssetValidationError(`Invalid ${resource} identifier.`);
    }
  }
}

export class AudioAssetValidationError extends ReferenceImageValidationError {
  constructor(message: string) {
    super(message);
    this.name = "AudioAssetValidationError";
  }
}
