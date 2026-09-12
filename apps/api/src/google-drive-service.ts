import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  driveBackupResultSchema,
  driveSyncResultSchema,
  integrationStatusSchema,
  type Backup,
  type DriveBackupResult,
  type DriveSyncResult,
  type IntegrationStatus,
} from "@ai-film-studio/contracts";
import type {
  BackupService,
  GoogleDriveClient,
  ManifestSynchronizer,
} from "@ai-film-studio/storage";
import { driveMimeType } from "@ai-film-studio/storage";

const oauthStateLifetimeMs = 10 * 60_000;

export class GoogleDriveService {
  private readonly oauthStates = new Map<string, number>();
  private syncing = false;

  constructor(
    private readonly client: GoogleDriveClient,
    private readonly backups: BackupService,
    private readonly manifests: ManifestSynchronizer,
    private readonly projectsPath: string,
    private readonly backupsPath: string,
  ) {}

  async status(): Promise<IntegrationStatus> {
    if (!this.client.configured()) {
      return integrationStatusSchema.parse({
        provider: "google-drive",
        state: "not_configured",
        folder: "OSPO",
        scope: "drive.file",
        redirectUri: this.client.redirectUri(),
        rootFolderId: null,
        rootFolderUrl: null,
        connectedAt: null,
        lastSyncAt: null,
        message:
          "Add Google OAuth client credentials to .env.local. Local verified backups remain available.",
      });
    }
    const credentials = await this.client.connection();
    if (!credentials) {
      return integrationStatusSchema.parse({
        provider: "google-drive",
        state: "ready_to_connect",
        folder: "OSPO",
        scope: "drive.file",
        redirectUri: this.client.redirectUri(),
        rootFolderId: null,
        rootFolderUrl: null,
        connectedAt: null,
        lastSyncAt: null,
        message:
          "OAuth credentials are configured, but no Google account is connected yet.",
      });
    }
    return integrationStatusSchema.parse({
      provider: "google-drive",
      state: "connected",
      folder: "OSPO",
      scope: "drive.file",
      redirectUri: this.client.redirectUri(),
      rootFolderId: credentials.rootFolderId ?? null,
      rootFolderUrl: credentials.rootFolderUrl ?? null,
      connectedAt: credentials.connectedAt,
      lastSyncAt: credentials.lastSyncAt ?? null,
      message:
        "Connected with limited drive.file access. AI Film Studio can manage only the OSPO files and folders it creates.",
    });
  }

  beginAuthorization(): string {
    this.pruneStates();
    const state = randomBytes(32).toString("base64url");
    this.oauthStates.set(state, Date.now() + oauthStateLifetimeMs);
    return this.client.authorizationUrl(state);
  }

  async completeAuthorization(state: string, code: string): Promise<void> {
    this.consumeState(state);
    await this.client.exchangeCode(code);
    await this.client.ensureWorkspace();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  async uploadBackup(backup: Backup): Promise<DriveBackupResult> {
    if (!(await this.client.connection())) {
      return driveBackupResultSchema.parse({
        state: "not_connected",
        fileId: null,
        webViewLink: null,
        message: "Local backup created; Google Drive is not connected.",
      });
    }
    try {
      const file = await this.client.uploadFile({
        localPath: path.join(this.backupsPath, path.basename(backup.filename)),
        remotePath: [
          "OSPO",
          "AI-Film-Studio",
          "backups",
          "database",
          backup.filename,
        ],
        mimeType: "application/vnd.sqlite3",
      });
      await this.client.markSynced();
      return driveBackupResultSchema.parse({
        state: "uploaded",
        fileId: file.id,
        webViewLink: file.webViewLink ?? null,
        message: "Local backup verified and uploaded to OSPO.",
      });
    } catch (error) {
      return driveBackupResultSchema.parse({
        state: "failed",
        fileId: null,
        webViewLink: null,
        message:
          error instanceof Error
            ? `Local backup is safe, but Drive upload failed: ${error.message}`
            : "Local backup is safe, but Drive upload failed.",
      });
    }
  }

  async syncWorkspace(): Promise<DriveSyncResult> {
    if (this.syncing) throw new GoogleDriveSyncBusyError();
    this.syncing = true;
    try {
      await this.manifests.drain();
      const workspace = await this.client.ensureWorkspace();
      const backup = await this.backups.create("manual");
      let uploadedFiles = 0;
      let uploadedBytes = 0;
      for (const filePath of await regularFiles(this.projectsPath)) {
        const relativePath = path.relative(this.projectsPath, filePath);
        const segments = relativePath.split(path.sep);
        const info = await stat(filePath);
        await this.client.uploadFile({
          localPath: filePath,
          remotePath: ["OSPO", "AI-Film-Studio", "projects", ...segments],
          mimeType: driveMimeType(filePath),
        });
        uploadedFiles += 1;
        uploadedBytes += info.size;
      }
      const backupPath = path.join(
        this.backupsPath,
        path.basename(backup.filename),
      );
      const backupInfo = await stat(backupPath);
      await this.client.uploadFile({
        localPath: backupPath,
        remotePath: [
          "OSPO",
          "AI-Film-Studio",
          "backups",
          "database",
          backup.filename,
        ],
        mimeType: "application/vnd.sqlite3",
      });
      uploadedFiles += 1;
      uploadedBytes += backupInfo.size;
      const completedAt = new Date().toISOString();
      await this.client.markSynced(completedAt);
      return driveSyncResultSchema.parse({
        ...workspace,
        uploadedFiles,
        uploadedBytes,
        backup,
        completedAt,
      });
    } finally {
      this.syncing = false;
    }
  }

  private pruneStates(): void {
    const now = Date.now();
    for (const [state, expiry] of this.oauthStates) {
      if (expiry <= now) this.oauthStates.delete(state);
    }
  }

  private consumeState(candidate: string): void {
    this.pruneStates();
    let matched: string | undefined;
    const candidateBuffer = Buffer.from(candidate);
    for (const state of this.oauthStates.keys()) {
      const stateBuffer = Buffer.from(state);
      if (
        stateBuffer.length === candidateBuffer.length &&
        timingSafeEqual(stateBuffer, candidateBuffer)
      ) {
        matched = state;
      }
    }
    if (!matched) throw new GoogleDriveOAuthStateError();
    this.oauthStates.delete(matched);
  }
}

async function regularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(filePath);
      else if (entry.isFile()) files.push(filePath);
    }
  }
  await walk(path.resolve(root));
  return files.sort();
}

export class GoogleDriveOAuthStateError extends Error {
  constructor() {
    super(
      "The Google OAuth request expired or its state did not match. Start the connection again from Settings.",
    );
    this.name = "GoogleDriveOAuthStateError";
  }
}

export class GoogleDriveSyncBusyError extends Error {
  constructor() {
    super("A Google Drive sync is already running.");
    this.name = "GoogleDriveSyncBusyError";
  }
}
