import { settingsSchema, type Settings } from "@ai-film-studio/contracts";

import type { DatabaseManager } from "./database-manager.js";

const defaults: Settings = {
  studioName: "My Film Studio",
  currency: "EUR",
  defaultLanguage: "en",
  automaticBackups: true,
  backupRetentionDays: 30,
  googleDriveFolder: "AI-Film-Studio",
};

export class SettingsRepository {
  constructor(private readonly manager: DatabaseManager) {}

  get(): Settings {
    const rows = this.manager.connection
      .prepare("SELECT key, value_json FROM settings")
      .all() as Array<{ key: string; value_json: string }>;
    const values = Object.fromEntries(
      rows.map((row) => [row.key, JSON.parse(row.value_json) as unknown]),
    );
    return settingsSchema.parse({ ...defaults, ...values });
  }

  update(input: Partial<Settings>): Settings {
    const settings = settingsSchema.parse({ ...this.get(), ...input });
    const statement = this.manager.connection.prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    );
    const timestamp = new Date().toISOString();
    this.manager.connection.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        statement.run(key, JSON.stringify(value), timestamp);
      }
    })();
    return settings;
  }
}
