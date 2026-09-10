import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import BetterSqlite3, { type Database } from "better-sqlite3";

import { runMigrations } from "./migrations.js";

export class DatabaseManager {
  readonly databasePath: string;
  #connection: Database | undefined;

  constructor(databasePath: string) {
    this.databasePath = path.resolve(databasePath);
  }

  get connection(): Database {
    if (!this.#connection) {
      throw new Error("Database connection is not open.");
    }
    return this.#connection;
  }

  async open(): Promise<void> {
    await mkdir(path.dirname(this.databasePath), { recursive: true });
    const connection = new BetterSqlite3(this.databasePath);
    try {
      connection.pragma("journal_mode = WAL");
      connection.pragma("foreign_keys = ON");
      connection.pragma("busy_timeout = 5000");
      connection.pragma("synchronous = NORMAL");
      runMigrations(connection);
      this.#connection = connection;
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  close(): void {
    this.#connection?.close();
    this.#connection = undefined;
  }

  async backup(destinationPath: string): Promise<void> {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await this.connection.backup(destinationPath);
  }

  async restore(sourcePath: string, rollbackPath: string): Promise<void> {
    await stat(sourcePath);
    this.close();

    try {
      await copyFile(this.databasePath, rollbackPath);
      await Promise.all([
        rm(`${this.databasePath}-wal`, { force: true }),
        rm(`${this.databasePath}-shm`, { force: true }),
      ]);
      await copyFile(sourcePath, this.databasePath);
      await this.open();
      const result = this.connection.pragma("integrity_check") as Array<{
        integrity_check: string;
      }>;
      if (result.length !== 1 || result[0]?.integrity_check !== "ok") {
        throw new Error("Restored database failed SQLite integrity_check.");
      }
    } catch (error) {
      this.close();
      try {
        await copyFile(rollbackPath, this.databasePath);
        await this.open();
      } catch {
        // Keep the original restore error; startup diagnostics will surface a
        // secondary failure if even the rollback cannot be opened.
      }
      throw error;
    }
  }
}
