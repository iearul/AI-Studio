import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Backup } from "@ai-studio/contracts";
import type {
  BackupService,
  GoogleDriveClient,
  ManifestSynchronizer,
} from "@ai-studio/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GoogleDriveService } from "../src/google-drive-service.js";

const bookId = "5c1f6a3e-8d1b-4c7a-9e2f-0a1b2c3d4e5f";

describe("Google Drive sync folders", () => {
  let directory: string;
  let uploads: string[];
  let connected: boolean;
  let service: GoogleDriveService;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "ai-studio-drive-sync-"));
    uploads = [];
    connected = true;
    const projectsPath = path.join(directory, "projects");
    const backupsPath = path.join(directory, "backups");
    const booksPath = path.join(directory, "books");
    await mkdir(path.join(projectsPath, "project-1"), { recursive: true });
    await writeFile(path.join(projectsPath, "project-1", "project.json"), "{}");
    await mkdir(path.join(booksPath, bookId, "exports", "e1"), {
      recursive: true,
    });
    await writeFile(
      path.join(booksPath, bookId, "exports", "e1", "story.epub"),
      "epub",
    );
    await mkdir(backupsPath, { recursive: true });
    const backup: Backup = {
      id: "0d6f0a39-4a8e-4e8b-9d55-6f1f0f0e7a11",
      filename: "ai-studio-test.sqlite",
      kind: "manual",
      sizeBytes: 6,
      checksumSha256: "0".repeat(64),
      createdAt: new Date().toISOString(),
    };
    await writeFile(path.join(backupsPath, backup.filename), "sqlite");

    const client = {
      configured: () => true,
      connection: () =>
        Promise.resolve(
          connected
            ? { refreshToken: "test", connectedAt: new Date().toISOString() }
            : undefined,
        ),
      ensureWorkspace: () =>
        Promise.resolve({
          rootFolderId: "root",
          rootFolderUrl: "https://drive.google.com/drive/folders/root",
        }),
      uploadFile: (input: { remotePath: string[] }) => {
        uploads.push(input.remotePath.join("/"));
        return Promise.resolve({
          id: `file-${uploads.length}`,
          name: input.remotePath.at(-1),
        });
      },
      markSynced: () => Promise.resolve(),
    } as unknown as GoogleDriveClient;

    service = new GoogleDriveService(
      client,
      { create: () => Promise.resolve(backup) } as unknown as BackupService,
      { drain: () => Promise.resolve() } as unknown as ManifestSynchronizer,
      projectsPath,
      backupsPath,
      {
        path: booksPath,
        activeIds: () => [bookId],
        writeBackupFile: async (id) => {
          await writeFile(path.join(booksPath, id, "book.json"), "{}");
        },
      },
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("gives a new KDP book its own folder outside the film folder", async () => {
    await service.syncBook(bookId);

    expect(uploads.sort()).toEqual([
      `OSPO/KDP-Story-Studio/books/${bookId}/book.json`,
      `OSPO/KDP-Story-Studio/books/${bookId}/exports/e1/story.epub`,
    ]);
  });

  it("uploads nothing for a new book while Drive is disconnected", async () => {
    connected = false;

    await service.syncBook(bookId);

    expect(uploads).toEqual([]);
  });

  it("keeps films in AI-Film-Studio and books in KDP-Story-Studio on a full sync", async () => {
    const result = await service.syncWorkspace();

    expect(uploads).toEqual([
      "OSPO/AI-Film-Studio/projects/project-1/project.json",
      `OSPO/KDP-Story-Studio/books/${bookId}/book.json`,
      `OSPO/KDP-Story-Studio/books/${bookId}/exports/e1/story.epub`,
      "OSPO/AI-Film-Studio/backups/database/ai-studio-test.sqlite",
    ]);
    expect(result.uploadedFiles).toBe(4);
  });
});
