import {
  BackupRepository,
  BibleRepository,
  DatabaseManager,
  ManifestOutboxRepository,
  ProjectRepository,
  SettingsRepository,
  StoryPlanRepository,
} from "@ai-film-studio/database";
import {
  BackupService,
  ensureStorageDirectories,
  ManifestSynchronizer,
  ProjectManifestStore,
  ReferenceImageStore,
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
  const storyPlans = new StoryPlanRepository(database, projects);
  const bible = new BibleRepository(database, projects);
  const backupRecords = new BackupRepository(database);
  const manifestOutbox = new ManifestOutboxRepository(database);
  const manifestStore = new ProjectManifestStore(storage.projectsPath);
  const referenceImages = new ReferenceImageStore(storage.projectsPath);
  const manifestSynchronizer = new ManifestSynchronizer(
    manifestOutbox,
    manifestStore,
    (projectId) => {
      const plan = storyPlans.get(projectId);
      const visualBible = bible.list(projectId);
      return {
        ...(plan
          ? {
              story: plan.story,
              script: plan.script,
              scenes: plan.scenes,
              shots: plan.scenes.flatMap((scene) => scene.shots),
            }
          : {}),
        ...visualBible,
      };
    },
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
    storyPlans,
    bible,
    backupRecords,
    manifestOutbox,
    manifestSynchronizer,
    referenceImages,
    backups,
  };
}
