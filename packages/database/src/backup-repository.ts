import { backupSchema, type Backup } from "@ai-studio/contracts";

import type { DatabaseManager } from "./database-manager.js";

type BackupRow = {
  id: string;
  filename: string;
  kind: string;
  size_bytes: number;
  checksum_sha256: string;
  created_at: string;
};

function mapBackup(row: BackupRow): Backup {
  return backupSchema.parse({
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    checksumSha256: row.checksum_sha256,
    createdAt: row.created_at,
  });
}

export class BackupRepository {
  constructor(private readonly manager: DatabaseManager) {}

  save(backup: Backup): void {
    this.manager.connection
      .prepare(
        `INSERT INTO backup_records
          (id, filename, kind, size_bytes, checksum_sha256, created_at)
         VALUES (@id, @filename, @kind, @sizeBytes, @checksumSha256, @createdAt)`,
      )
      .run(backup);
  }

  list(): Backup[] {
    const rows = this.manager.connection
      .prepare(
        `SELECT id, filename, kind, size_bytes, checksum_sha256, created_at
         FROM backup_records ORDER BY created_at DESC`,
      )
      .all() as BackupRow[];
    return rows.map(mapBackup);
  }

  getById(id: string): Backup | undefined {
    const row = this.manager.connection
      .prepare(
        `SELECT id, filename, kind, size_bytes, checksum_sha256, created_at
         FROM backup_records WHERE id = ?`,
      )
      .get(id) as BackupRow | undefined;
    return row ? mapBackup(row) : undefined;
  }
}
