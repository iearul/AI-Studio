import path from "node:path";

import { kdpLocalOwnerId } from "@ai-studio/contracts";
import {
  AudioRepository,
  BackupRepository,
  BibleRepository,
  DatabaseManager,
  GenerationRepository,
  KdpBookRepository,
  KdpJobRepository,
  KdpStoryRepository,
  ManifestOutboxRepository,
  ProjectRepository,
  SettingsRepository,
  StoryPlanRepository,
  VideoRepository,
} from "@ai-studio/database";
import {
  AnthropicTextProvider,
  ElevenLabsAudioProvider,
  GeminiImageProvider,
  KlingVideoProvider,
  OllamaTextProvider,
  OpenAiImageProvider,
  OpenAiTextProvider,
  SeedanceVideoProvider,
  VeoVideoProvider,
  resolveAnthropicTextProviderConfig,
  resolveElevenLabsAudioProviderConfig,
  resolveGeminiImageProviderConfig,
  resolveKlingVideoProviderConfig,
  resolveOllamaTextProviderConfig,
  resolveOpenAiImageProviderConfig,
  resolveOpenAiTextProviderConfig,
  resolveSeedanceVideoProviderConfig,
  resolveVeoVideoProviderConfig,
  type AudioProvider,
  type ImageProvider,
  type TextProvider,
  type VideoProvider,
} from "@ai-studio/providers";
import {
  AudioAssetStore,
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
} from "@ai-studio/storage";

import type { FastifyRequest } from "fastify";

import { AudioGenerationService } from "./audio-generation-service.js";
import { KdpAiRouter } from "./kdp/ai-router.js";
import { BookFileStore } from "./kdp/book-files.js";
import { DictationService } from "./kdp/dictation.js";
import { KdpExportService } from "./kdp/export-service.js";
import { KdpJobRunner, type JobRunnerOptions } from "./kdp/job-runner.js";
import { KdpService } from "./kdp/kdp-service.js";
import { KdpPipeline } from "./kdp/pipeline.js";
import { KdpProvenanceService } from "./kdp/provenance-service.js";
import { ImageGenerationService } from "./image-generation-service.js";
import { GoogleDriveService } from "./google-drive-service.js";
import { StoryGenerationService } from "./story-generation-service.js";
import { VideoGenerationService } from "./video-generation-service.js";

export type Services = Awaited<ReturnType<typeof createServices>>;

export async function createServices(
  options: {
    textProviders?: TextProvider[];
    imageProviders?: ImageProvider[];
    audioProvider?: AudioProvider;
    videoProviders?: VideoProvider[];
    /** KDP Story Studio providers; defaults to the story text providers. */
    kdpTextProviders?: TextProvider[];
    kdpSleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    kdpRunner?: JobRunnerOptions;
    /** Speech-to-text for voice prompts; defaults to local mlx-whisper. */
    kdpDictation?: DictationService;
    /**
     * The app has no login: every request belongs to the local owner. A future
     * login only replaces this function.
     */
    resolveOwner?: (request: FastifyRequest) => string;
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
  const audio = new AudioRepository(database, projects);
  const backupRecords = new BackupRepository(database);
  const manifestOutbox = new ManifestOutboxRepository(database);
  const manifestStore = new ProjectManifestStore(storage.projectsPath);
  const referenceImages = new ReferenceImageStore(storage.projectsPath);
  const storyboardAssets = new StoryboardAssetStore(storage.projectsPath);
  const videoAssets = new VideoAssetStore(storage.projectsPath);
  const audioAssets = new AudioAssetStore(storage.projectsPath);
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
  const imageProviders = options.imageProviders ?? [
    new OpenAiImageProvider(resolveOpenAiImageProviderConfig()),
    new GeminiImageProvider(resolveGeminiImageProviderConfig()),
  ];
  const videoProviders = options.videoProviders ?? [
    new KlingVideoProvider(resolveKlingVideoProviderConfig()),
    new SeedanceVideoProvider(resolveSeedanceVideoProviderConfig()),
    new VeoVideoProvider(resolveVeoVideoProviderConfig()),
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
        voiceProfiles: audio.listVoiceProfiles(projectId),
        audioAttempts: audio.listProject(projectId),
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
    referenceImages,
    manifestSynchronizer,
    imageProviders,
  );
  const audioGenerations = new AudioGenerationService(
    audio,
    projects,
    storyPlans,
    bible,
    audioAssets,
    manifestSynchronizer,
    options.audioProvider ??
      new ElevenLabsAudioProvider(resolveElevenLabsAudioProviderConfig()),
  );
  // Image and audio requests run inside this process, so none survive a restart.
  generations.failInterrupted();
  audio.failInterrupted();
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
  const kdpBooks = new KdpBookRepository(database);
  const kdpStory = new KdpStoryRepository(database);
  const kdpJobs = new KdpJobRepository(database);
  const bookFiles = new BookFileStore(
    path.resolve(
      storage.workspaceRoot,
      process.env.BOOKS_PATH ??
        path.join(path.dirname(storage.projectsPath), "books"),
    ),
  );
  const kdpAi = new KdpAiRouter(
    options.kdpTextProviders ?? textProviders,
    kdpJobs,
    options.kdpSleep,
  );
  const kdpProvenance = new KdpProvenanceService(kdpBooks, kdpStory, kdpJobs);
  const kdpPipeline = new KdpPipeline(kdpBooks, kdpStory, kdpAi);
  const kdpRunner = new KdpJobRunner(
    kdpJobs,
    kdpPipeline.handlers(),
    options.kdpRunner,
  );
  const kdp = {
    books: kdpBooks,
    story: kdpStory,
    jobs: kdpJobs,
    files: bookFiles,
    ai: kdpAi,
    pipeline: kdpPipeline,
    runner: kdpRunner,
    provenance: kdpProvenance,
    service: new KdpService(
      kdpBooks,
      kdpStory,
      kdpJobs,
      kdpAi,
      kdpRunner,
      bookFiles,
      kdpProvenance,
    ),
    exports: new KdpExportService(
      kdpBooks,
      kdpStory,
      kdpJobs,
      bookFiles,
      kdpProvenance,
    ),
    dictation: options.kdpDictation ?? new DictationService(),
    resolveOwner: options.resolveOwner ?? (() => kdpLocalOwnerId),
  };
  const googleDrive = new GoogleDriveService(
    googleDriveClient,
    backups,
    manifestSynchronizer,
    storage.projectsPath,
    storage.backupsPath,
    {
      path: bookFiles.root,
      activeIds: () => kdpBooks.activeIds(),
      writeBackupFile: (bookId) => kdp.exports.writeBackupFile(bookId),
    },
  );

  await manifestSynchronizer.drain();

  return {
    kdp,
    storage,
    database,
    projects,
    settings,
    storyPlans,
    bible,
    generations,
    videos,
    audio,
    backupRecords,
    manifestOutbox,
    manifestSynchronizer,
    referenceImages,
    storyboardAssets,
    videoAssets,
    audioAssets,
    imageGenerations,
    audioGenerations,
    storyGenerations,
    videoGenerations,
    googleDrive,
    googleDriveClient,
    googleDriveTokens,
    backups,
  };
}
