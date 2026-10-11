import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Database } from "better-sqlite3";

const migrationDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const rebuildMarker = "-- migration: table-rebuild";

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
    // Table rebuilds must run with foreign keys off, or dropping the old table
    // cascades into every child row. SQLite ignores this pragma inside a
    // transaction, so it is switched before and restored after.
    const rebuild = sql.startsWith(rebuildMarker);
    if (rebuild) database.pragma("foreign_keys = OFF");
    try {
      database.transaction(() => {
        database.exec(sql);
        if (rebuild) {
          const violations = database.pragma("foreign_key_check") as unknown[];
          if (violations.length > 0) {
            throw new Error(
              `Migration ${filename} left ${violations.length} foreign key violations.`,
            );
          }
        }
        database
          .prepare(
            "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
          )
          .run(filename, new Date().toISOString());
      })();
    } finally {
      if (rebuild) database.pragma("foreign_keys = ON");
    }
  }
}
