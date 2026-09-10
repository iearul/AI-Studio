import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Database } from "better-sqlite3";

const migrationDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

export function runMigrations(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    database
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => (row as { id: string }).id),
  );

  const filenames = readdirSync(migrationDirectory)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    if (applied.has(filename)) continue;
    const sql = readFileSync(path.join(migrationDirectory, filename), "utf8");
    database.transaction(() => {
      database.exec(sql);
      database
        .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run(filename, new Date().toISOString());
    })();
  }
}
