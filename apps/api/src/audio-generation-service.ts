import {
  audioWorkspaceSchema,
  type AudioAttempt,
  type AudioKind,
  type AudioProviderStatus,
  type AudioWorkspace,
  type Project,
  type SaveVoiceProfile,
  type Scene,
  type Shot,
  type StoryPlan,
  type Voice,
  type VoiceProfile,
} from "@ai-film-studio/contracts";
import {
  GenerationNotFoundError,
  GenerationStateError,
  type AudioRepository,
  type BibleRepository,
  type ProjectRepository,
  type StoryPlanRepository,
} from "@ai-film-studio/database";
import {
  buildMusicPrompt,
  buildSoundEffectPrompt,
  musicDuration,
  parseDialogue,
  soundEffectDuration,
  speechLanguageCode,
} from "@ai-film-studio/film-engine";
import type { AudioProvider, GeneratedAudio } from "@ai-film-studio/providers";
import type {
  AudioAssetStore,
  ManifestSynchronizer,
} from "@ai-film-studio/storage";

// ElevenLabs text-to-dialogue accepts at most this much text and ten voices.
const maxDialogueCharacters = 2000;
const maxDialogueVoices = 10;

type AttemptPlan = {
  kind: AudioKind;
  targetKey: string;
  sceneId: string | null;
  shotId: string | null;
  model: string;
  text: string;
  settings: Record<string, unknown>;
};

export class AudioGenerationService {
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly audio: AudioRepository,
    private readonly projects: ProjectRepository,
    private readonly storyPlans: StoryPlanRepository,
    private readonly bible: BibleRepository,
    private readonly audioAssets: AudioAssetStore,
    private readonly manifests: ManifestSynchronizer,
    private readonly provider: AudioProvider,
  ) {}

  status(): AudioProviderStatus {
    return this.provider.status();
  }

  async listVoices(): Promise<Voice[]> {
    this.requireConfigured();
    return this.provider.listVoices();
  }

  workspace(projectId: string): AudioWorkspace {
    const project = this.requireProject(projectId);
    const plan = this.storyPlans.get(projectId);
    const characters = this.bible.list(projectId).characters;
    const profiles = this.audio.listVoiceProfiles(projectId);
    const attempts = this.audio.listProject(projectId);
    const byTarget = new Map<string, AudioAttempt[]>();
    for (const attempt of attempts) {
      byTarget.set(attempt.targetKey, [
        ...(byTarget.get(attempt.targetKey) ?? []),
        attempt,
      ]);
    }
    const voiced = new Set(
      profiles.flatMap((profile) =>
        profile.characterId ? [profile.characterId] : [],
      ),
    );
    return audioWorkspaceSchema.parse({
      provider: this.provider.status(),
      languageCode: speechLanguageCode(project),
      narrator: profiles.find((profile) => profile.role === "narrator") ?? null,
      characters: characters.map((character) => ({
        characterId: character.id,
        code: character.code,
        name: character.name,
        voiceDescription: [character.voice, character.speechStyle]
          .filter(Boolean)
          .join(" · "),
        profile:
          profiles.find((profile) => profile.characterId === character.id) ??
          null,
      })),
      music: {
        prompt: buildMusicPrompt(project, plan),
        durationSeconds: musicDuration(project, plan),
        attempts: byTarget.get(musicTarget) ?? [],
      },
      scenes: (plan?.scenes ?? []).map((scene) => {
        const lines = parseDialogue(scene, characters);
        return {
          sceneId: scene.id,
          sceneNumber: scene.sceneNumber,
          location: scene.location,
          narration: {
            text: scene.narration?.trim() || null,
            attempts: byTarget.get(narrationTarget(scene.id)) ?? [],
          },
          dialogue: {
            lines,
            missingVoices: [
              ...new Set(
                lines
                  .filter(
                    (line) =>
                      !line.characterId || !voiced.has(line.characterId),
                  )
                  .map((line) => line.speaker),
              ),
            ],
            attempts: byTarget.get(dialogueTarget(scene.id)) ?? [],
          },
          shots: scene.shots.map((shot) => ({
            shotId: shot.id,
            shotCode: shot.code,
            action: shot.action,
            soundEffects: {
              prompt: buildSoundEffectPrompt(scene, shot),
              durationSeconds: soundEffectDuration(shot),
              attempts: byTarget.get(soundEffectTarget(shot.id)) ?? [],
            },
          })),
        };
      }),
      totals: {
        attempts: attempts.length,
        succeeded: attempts.filter((item) => item.status === "succeeded")
          .length,
        approved: attempts.filter((item) => item.reviewStatus === "approved")
          .length,
        failed: attempts.filter((item) => item.status === "failed").length,
        costMicros: attempts.reduce(
          (total, item) => total + item.costMicros,
          0,
        ),
        currency: "USD",
      },
    });
  }

  async saveVoiceProfile(
    projectId: string,
    input: SaveVoiceProfile,
  ): Promise<VoiceProfile> {
    const profile = this.audio.saveVoiceProfile(projectId, input);
    await this.manifests.drain();
    return profile;
  }

  async generateNarration(
    projectId: string,
    sceneId: string,
  ): Promise<AudioAttempt> {
    const { project, scene } = this.requireScene(projectId, sceneId);
    const text = scene.narration?.trim();
    if (!text) {
      throw new GenerationStateError("This scene has no narration text.");
    }
    const narrator = this.audio
      .listVoiceProfiles(projectId)
      .find((profile) => profile.role === "narrator");
    if (!narrator) {
      throw new GenerationStateError("Choose a narrator voice first.");
    }
    const languageCode = speechLanguageCode(project);
    return this.start(
      projectId,
      {
        kind: "narration",
        targetKey: narrationTarget(scene.id),
        sceneId: scene.id,
        shotId: null,
        model: this.provider.status().speechModel,
        text,
        settings: {
          voiceId: narrator.voiceId,
          voiceName: narrator.voiceName,
          languageCode,
        },
      },
      () =>
        this.provider.speech({ voiceId: narrator.voiceId, text, languageCode }),
    );
  }

  async generateDialogue(
    projectId: string,
    sceneId: string,
  ): Promise<AudioAttempt> {
    const { project, scene } = this.requireScene(projectId, sceneId);
    const lines = parseDialogue(scene, this.bible.list(projectId).characters);
    if (lines.length === 0) {
      throw new GenerationStateError("This scene has no dialogue.");
    }
    const profiles = new Map(
      this.audio
        .listVoiceProfiles(projectId)
        .flatMap((profile) =>
          profile.characterId ? [[profile.characterId, profile] as const] : [],
        ),
    );
    const missing = [
      ...new Set(
        lines
          .filter(
            (line) => !line.characterId || !profiles.has(line.characterId),
          )
          .map((line) => line.speaker),
      ),
    ];
    if (missing.length > 0) {
      throw new GenerationStateError(
        `Choose a voice for ${missing.join(", ")} before generating this dialogue.`,
      );
    }
    const turns = lines.map((line) => ({
      voiceId: profiles.get(line.characterId!)!.voiceId,
      text: line.text,
    }));
    const characters = turns.reduce(
      (total, turn) => total + turn.text.length,
      0,
    );
    if (characters > maxDialogueCharacters) {
      throw new GenerationStateError(
        `This dialogue has ${characters} characters; ElevenLabs accepts up to ${maxDialogueCharacters} per scene. Shorten it or split the scene.`,
      );
    }
    if (new Set(turns.map((turn) => turn.voiceId)).size > maxDialogueVoices) {
      throw new GenerationStateError(
        `ElevenLabs dialogue supports up to ${maxDialogueVoices} different voices per scene.`,
      );
    }
    const languageCode = speechLanguageCode(project);
    return this.start(
      projectId,
      {
        kind: "dialogue",
        targetKey: dialogueTarget(scene.id),
        sceneId: scene.id,
        shotId: null,
        model: this.provider.status().speechModel,
        text: lines.map((line) => `${line.speaker}: ${line.text}`).join("\n"),
        settings: {
          voices: lines.map((line) => ({
            speaker: line.speaker,
            voiceId: profiles.get(line.characterId!)!.voiceId,
          })),
          languageCode,
        },
      },
      () => this.provider.dialogue({ turns, languageCode }),
    );
  }

  async generateSoundEffect(
    projectId: string,
    shotId: string,
  ): Promise<AudioAttempt> {
    const { scene, shot } = this.requireShot(projectId, shotId);
    const prompt = buildSoundEffectPrompt(scene, shot);
    const durationSeconds = soundEffectDuration(shot);
    return this.start(
      projectId,
      {
        kind: "sfx",
        targetKey: soundEffectTarget(shot.id),
        sceneId: scene.id,
        shotId: shot.id,
        model: this.provider.status().soundEffectModel,
        text: prompt,
        settings: { durationSeconds },
      },
      () => this.provider.soundEffect({ prompt, durationSeconds }),
    );
  }

  async generateMusic(projectId: string): Promise<AudioAttempt> {
    const project = this.requireProject(projectId);
    const plan = this.storyPlans.get(projectId);
    const prompt = buildMusicPrompt(project, plan);
    const durationSeconds = musicDuration(project, plan);
    return this.start(
      projectId,
      {
        kind: "music",
        targetKey: musicTarget,
        sceneId: null,
        shotId: null,
        model: this.provider.status().musicModel,
        text: prompt,
        settings: { durationSeconds, instrumental: true },
      },
      () => this.provider.music({ prompt, durationSeconds }),
    );
  }

  async review(
    projectId: string,
    attemptId: string,
    decision: "approve" | "reject",
  ): Promise<AudioAttempt> {
    const attempt = this.audio.review(projectId, attemptId, decision);
    await this.manifests.drain();
    return attempt;
  }

  /** Resolves when every background generation has finished. */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.running]);
  }

  private async start(
    projectId: string,
    plan: AttemptPlan,
    run: () => Promise<GeneratedAudio>,
  ): Promise<AudioAttempt> {
    this.requireConfigured();
    const attempt = this.audio.begin({ projectId, ...plan });
    await this.manifests.drain();
    const task = this.complete(projectId, attempt, run).finally(() =>
      this.running.delete(task),
    );
    this.running.add(task);
    return attempt;
  }

  private async complete(
    projectId: string,
    attempt: AudioAttempt,
    run: () => Promise<GeneratedAudio>,
  ): Promise<void> {
    const startedAt = Date.now();
    let storedPath: string | undefined;
    try {
      const generated = await run();
      const asset = await this.audioAssets.save({
        projectId,
        attemptId: attempt.id,
        kind: attempt.kind,
        buffer: generated.data,
      });
      storedPath = asset.relativePath;
      this.audio.complete(
        projectId,
        attempt.id,
        asset,
        Date.now() - startedAt,
        generated.costMicros,
      );
    } catch (error) {
      try {
        if (storedPath) await this.audioAssets.remove(projectId, storedPath);
        this.audio.fail(projectId, attempt.id, error);
      } catch {
        // The database may already be closed during shutdown; startup marks
        // the attempt as interrupted instead.
        return;
      }
    }
    try {
      await this.manifests.drain();
    } catch {
      // The manifest stays dirty and is written on the next successful drain.
    }
  }

  private requireConfigured(): void {
    const status = this.provider.status();
    if (!status.configured) throw new GenerationStateError(status.message);
  }

  private requireProject(projectId: string): Project {
    const project = this.projects.getById(projectId);
    if (!project) throw new GenerationNotFoundError("Project");
    return project;
  }

  private requirePlan(projectId: string): {
    project: Project;
    plan: StoryPlan;
  } {
    const project = this.requireProject(projectId);
    const plan = this.storyPlans.get(projectId);
    if (!plan) {
      throw new GenerationStateError(
        "Create and import a story plan before generating sound.",
      );
    }
    return { project, plan };
  }

  private requireScene(
    projectId: string,
    sceneId: string,
  ): { project: Project; scene: Scene } {
    const { project, plan } = this.requirePlan(projectId);
    const scene = plan.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new GenerationNotFoundError("Scene");
    return { project, scene };
  }

  private requireShot(
    projectId: string,
    shotId: string,
  ): { scene: Scene; shot: Shot } {
    const { plan } = this.requirePlan(projectId);
    for (const scene of plan.scenes) {
      const shot = scene.shots.find((candidate) => candidate.id === shotId);
      if (shot) return { scene, shot };
    }
    throw new GenerationNotFoundError("Shot");
  }
}

const musicTarget = "music:project";

function narrationTarget(sceneId: string): string {
  return `narration:${sceneId}`;
}

function dialogueTarget(sceneId: string): string {
  return `dialogue:${sceneId}`;
}

function soundEffectTarget(shotId: string): string {
  return `sfx:${shotId}`;
}
