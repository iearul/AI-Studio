import {
  BackupRepository,
  BibleRepository,
  DatabaseManager,
  GenerationRepository,
  ManifestOutboxRepository,
  ProjectRepository,
  SettingsRepository,
  StoryPlanRepository,
  VideoRepository,
} from "@ai-film-studio/database";
import {
  AnthropicTextProvider,
  KlingVideoProvider,
  OllamaTextProvider,
  OpenAiTextProvider,
  SeedanceVideoProvider,
  resolveAnthropicTextProviderConfig,
  resolveKlingVideoProviderConfig,
  resolveOllamaTextProviderConfig,
  resolveOpenAiTextProviderConfig,
  resolveSeedanceVideoProviderConfig,
  type TextProvider,
  type VideoProvider,
} from "@ai-film-studio/providers";
import {
  BackupService,
  ensureStorageDirectories,
  GoogleDriveClient,
  GoogleDriveTokenStore,
  ManifestSynchronizer,
  ProjectManifestStore,
  ReferenceImageStore,
  resolveStorageConfig,
  StoryboardAssetStore,
  VideoAssetStore,
  type StorageConfig,
} from "@ai-film-studio/storage";

import { ImageGenerationService } from "./image-generation-service.js";
import { GoogleDriveService } from "./google-drive-service.js";
import { StoryGenerationService } from "./story-generation-service.js";
import { VideoGenerationService } from "./video-generation-service.js";

export type Services = Awaited<ReturnType<typeof createServices>>;

export async function createServices(
  options: {
    textProviders?: TextProvider[];
    videoProviders?: VideoProvider[];
  } = {},
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
  const videos = new VideoRepository(database, projects);
  const backupRecords = new BackupRepository(database);
  const manifestOutbox = new ManifestOutboxRepository(database);
  const manifestStore = new ProjectManifestStore(storage.projectsPath);
  const referenceImages = new ReferenceImageStore(storage.projectsPath);
  const storyboardAssets = new StoryboardAssetStore(storage.projectsPath);
  const videoAssets = new VideoAssetStore(storage.projectsPath);
  const googleDriveTokens = new GoogleDriveTokenStore(storage.secretsPath);
  const googleDriveClient = new GoogleDriveClient(
    {
      clientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
      redirectUri:
        process.env.GOOGLE_REDIRECT_URI?.trim() ||
        "http://127.0.0.1:4100/api/v1/integrations/google-drive/callback",
    },
    googleDriveTokens,
  );
  const textProviders = options.textProviders ?? [
    new OpenAiTextProvider(resolveOpenAiTextProviderConfig()),
    new AnthropicTextProvider(resolveAnthropicTextProviderConfig()),
    new OllamaTextProvider(resolveOllamaTextProviderConfig()),
  ];
  const videoProviders = options.videoProviders ?? [
    new KlingVideoProvider(resolveKlingVideoProviderConfig()),
    new SeedanceVideoProvider(resolveSeedanceVideoProviderConfig()),
  ];
  const manifestSynchronizer = new ManifestSynchronizer(
    manifestOutbox,
    manifestStore,
    (projectId) => {
      const plan = storyPlans.get(projectId);
      const visualBible = bible.list(projectId);
      const imageHistory = generations.listProject(projectId);
      const videoHistory = videos.listProject(projectId);
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
        videoAssets: videoHistory.attempts.flatMap((attempt) =>
          attempt.asset ? [attempt.asset] : [],
        ),
        videoAttempts: videoHistory.attempts,
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
    storyboardAssets,
    manifestSynchronizer,
  );
  const storyGenerations = new StoryGenerationService(projects, textProviders);
  const videoGenerations = new VideoGenerationService(
    videos,
    generations,
    projects,
    storyPlans,
    storyboardAssets,
    videoAssets,
    manifestSynchronizer,
    videoProviders,
  );
  const googleDrive = new GoogleDriveService(
    googleDriveClient,
    backups,
    manifestSynchronizer,
    storage.projectsPath,
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
    generations,
    videos,
    backupRecords,
    manifestOutbox,
    manifestSynchronizer,
    referenceImages,
    storyboardAssets,
    videoAssets,
    imageGenerations,
    storyGenerations,
    videoGenerations,
    googleDrive,
    googleDriveClient,
    googleDriveTokens,
    backups,
  };
}
