import {
  BackupRepository,
  BibleRepository,
  DatabaseManager,
  GenerationRepository,
  ManifestOutboxRepository,
  ProjectRepository,
  SettingsRepository,
  StoryPlanRepository,
} from "@ai-film-studio/database";
import {
  ComfyUiImageProvider,
  resolveComfyUiImageProviderConfig,
  type ImageProvider,
} from "@ai-film-studio/providers";
import {
  BackupService,
  ensureStorageDirectories,
  ManifestSynchronizer,
  ProjectManifestStore,
  ReferenceImageStore,
  resolveStorageConfig,
  StoryboardAssetStore,
  type StorageConfig,
} from "@ai-film-studio/storage";

import { ImageGenerationService } from "./image-generation-service.js";

export type Services = Awaited<ReturnType<typeof createServices>>;

export async function createServices(
  options: { imageProvider?: ImageProvider } = {},
) {
  const storage: StorageConfig = resolveStorageConfig();
  await ensureStorageDirectories(storage);
  const database = new DatabaseManager(storage.databasePath);
  await database.open();

  const projects = new ProjectRepository(database);
  const settings = new SettingsRepository(database);
  const storyPlans = new StoryPlanRepository(database, projects);
  const bible = new BibleRepository(database, projects);
  const generations = new GenerationRepository(database, projects);
  const backupRecords = new BackupRepository(database);
  const manifestOutbox = new ManifestOutboxRepository(database);
  const manifestStore = new ProjectManifestStore(storage.projectsPath);
  const referenceImages = new ReferenceImageStore(storage.projectsPath);
  const storyboardAssets = new StoryboardAssetStore(storage.projectsPath);
  const comfyUi = new ComfyUiImageProvider(
    resolveComfyUiImageProviderConfig(storage.workspaceRoot),
  );
  const imageProvider = options.imageProvider ?? comfyUi;
  const manifestSynchronizer = new ManifestSynchronizer(
    manifestOutbox,
    manifestStore,
    (projectId) => {
      const plan = storyPlans.get(projectId);
      const visualBible = bible.list(projectId);
      const imageHistory = generations.listProject(projectId);
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
        assets: imageHistory.attempts.flatMap((attempt) =>
          attempt.asset ? [attempt.asset] : [],
        ),
        generationAttempts: imageHistory.attempts,
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
  const imageGenerations = new ImageGenerationService(
    generations,
    projects,
    storyPlans,
    bible,
    referenceImages,
    storyboardAssets,
    imageProvider,
    manifestSynchronizer,
  );

  await manifestSynchronizer.drain();

  return {
    storage,
    database,
    projects,
    settings,
    storyPlans,
    bible,
    generations,
    backupRecords,
    manifestOutbox,
    manifestSynchronizer,
    referenceImages,
    storyboardAssets,
    comfyUi,
    imageGenerations,
    backups,
  };
}
