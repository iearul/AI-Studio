import {
  BackupRepository,
  DatabaseManager,
  ManifestOutboxRepository,
  ProjectRepository,
  SettingsRepository,
} from "@ai-film-studio/database";
import {
  BackupService,
  ensureStorageDirectories,
  ManifestSynchronizer,
  ProjectManifestStore,
  resolveStorageConfig,
  type StorageConfig,
} from "@ai-film-studio/storage";

export type Services = Awaited<ReturnType<typeof createServices>>;

export async function createServices() {
  const storage: StorageConfig = resolveStorageConfig();
  await ensureStorageDirectories(storage);
  const database = new DatabaseManager(storage.databasePath);
  await database.open();

  const projects = new ProjectRepository(database);
  const settings = new SettingsRepository(database);
  const backupRecords = new BackupRepository(database);
  const manifestOutbox = new ManifestOutboxRepository(database);
  const manifestStore = new ProjectManifestStore(storage.projectsPath);
  const manifestSynchronizer = new ManifestSynchronizer(
    manifestOutbox,
    manifestStore,
  );
  const backups = new BackupService(
    database,
    backupRecords,
    projects,
    manifestSynchronizer,
    storage.backupsPath,
  );

  await manifestSynchronizer.drain();

  return {
    storage,
    database,
    projects,
    settings,
    backupRecords,
    manifestOutbox,
    manifestSynchronizer,
    backups,
  };
}
