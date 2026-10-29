import type { Project } from "@ai-studio/contracts";

import type { DatabaseManager } from "./database-manager.js";

export type ManifestOutboxItem = {
  projectId: string;
  project: Project;
  attempts: number;
};

export class ManifestOutboxRepository {
  constructor(private readonly manager: DatabaseManager) {}

  list(limit = 100): ManifestOutboxItem[] {
    const rows = this.manager.connection
      .prepare(
        `SELECT project_id, project_json, attempts
         FROM manifest_outbox ORDER BY updated_at ASC LIMIT ?`,
      )
      .all(limit) as Array<{
      project_id: string;
      project_json: string;
      attempts: number;
    }>;
    return rows.map((row) => ({
      projectId: row.project_id,
      project: JSON.parse(row.project_json) as Project,
      attempts: row.attempts,
    }));
  }

  count(): number {
    const row = this.manager.connection
      .prepare("SELECT count(*) AS count FROM manifest_outbox")
      .get() as { count: number };
    return row.count;
  }

  complete(projectId: string): void {
    this.manager.connection
      .prepare("DELETE FROM manifest_outbox WHERE project_id = ?")
      .run(projectId);
  }

  fail(projectId: string, error: string): void {
    this.manager.connection
      .prepare(
        `UPDATE manifest_outbox
         SET attempts = attempts + 1, last_error = ?, updated_at = ?
         WHERE project_id = ?`,
      )
      .run(error.slice(0, 2000), new Date().toISOString(), projectId);
  }
}
