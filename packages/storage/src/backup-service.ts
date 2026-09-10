import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { backupSchema, type Backup } from "@ai-film-studio/contracts";
import {
  type BackupRepository,
  type DatabaseManager,
  type ProjectRepository,
} from "@ai-film-studio/database";

import type { ManifestSynchronizer } from "./manifest-synchronizer.js";

function filesystemTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function sha256(filePath: string): Promise<string> {
  const file = await readFile(filePath);
  return createHash("sha256").update(file).digest("hex");
}

export class BackupService {
  constructor(
    private readonly manager: DatabaseManager,
    private readonly backups: BackupRepository,
    private readonly projects: ProjectRepository,
    private readonly manifests: ManifestSynchronizer,
    private readonly backupsPath: string,
  ) {}

  list(): Backup[] {
    return this.backups.list();
  }

  async create(
    kind: Backup["kind"] = "manual",
    options: { record?: boolean } = {},
  ): Promise<Backup> {
    const createdAt = new Date();
    const id = randomUUID();
    const filename = `film-studio-${filesystemTimestamp(createdAt)}-${id.slice(0, 8)}.sqlite`;
    const destination = path.join(this.backupsPath, filename);
    await this.manager.backup(destination);
    const info = await stat(destination);
    const backup = backupSchema.parse({
      id,
      filename,
      kind,
      sizeBytes: info.size,
      checksumSha256: await sha256(destination),
      createdAt: createdAt.toISOString(),
    });
    if (options.record !== false) this.backups.save(backup);
    return backup;
  }

  async restore(id: string): Promise<Backup> {
    const backup = this.backups.getById(id);
    if (!backup) throw new BackupNotFoundError(id);
    const source = path.join(this.backupsPath, path.basename(backup.filename));
    if ((await sha256(source)) !== backup.checksumSha256) {
      throw new BackupIntegrityError(backup.filename);
    }

    const rollback = await this.create("pre_restore", { record: false });
    const rollbackPath = path.join(this.backupsPath, rollback.filename);
    await this.manager.restore(source, rollbackPath);
    if (!this.backups.getById(backup.id)) this.backups.save(backup);
    this.backups.save(rollback);
    this.projects.queueAllManifests();
    await this.manifests.drain();
    return backup;
  }
}

export class BackupNotFoundError extends Error {
  constructor(id: string) {
    super(`Backup ${id} was not found.`);
    this.name = "BackupNotFoundError";
  }
}

export class BackupIntegrityError extends Error {
  constructor(filename: string) {
    super(`Backup ${filename} failed its SHA-256 integrity check.`);
    this.name = "BackupIntegrityError";
  }
}
