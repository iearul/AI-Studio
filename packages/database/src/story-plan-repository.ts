import { randomUUID } from "node:crypto";

import {
  sceneSchema,
  scriptSchema,
  shotSchema,
  storyPlanInputSchema,
  storyPlanSchema,
  storySchema,
  type Scene,
  type Script,
  type Shot,
  type Story,
  type StoryPlan,
  type StoryPlanInput,
} from "@ai-film-studio/contracts";

import type { DatabaseManager } from "./database-manager.js";
import type { ProjectRepository } from "./project-repository.js";

type StoryRow = {
  id: string;
  project_id: string;
  title: string;
  logline: string;
  genre: string;
  theme: string;
  tone: string;
  main_conflict: string;
  main_character: string;
  supporting_characters_json: string;
  beginning: string;
  middle: string;
  climax: string;
  ending: string;
  audience_emotion: string;
  hook: string | null;
  twist: string | null;
  cliffhanger: string | null;
  retention_moments_json: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type ScriptRow = {
  id: string;
  project_id: string;
  title: string;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type SceneRow = {
  id: string;
  project_id: string;
  script_id: string;
  position: number;
  scene_number: number;
  location: string;
  time_of_day: string;
  characters_json: string;
  action: string;
  narration: string | null;
  dialogue: string | null;
  estimated_duration_seconds: number;
  emotional_purpose: string;
  created_at: string;
  updated_at: string;
};

type ShotRow = {
  id: string;
  project_id: string;
  scene_id: string;
  position: number;
  code: string;
  duration_seconds: number;
  characters_json: string;
  location: string;
  shot_type: string;
  camera_angle: string;
  lens: string;
  camera_movement: string;
  action: string;
  lighting: string;
  emotion: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function parseStringArray(json: string): string[] {
  const value = JSON.parse(json) as unknown;
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error("Database JSON array invariant failed.");
  }
  return value;
}

function mapStory(row: StoryRow): Story {
  return storySchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    logline: row.logline,
    genre: row.genre,
    theme: row.theme,
    tone: row.tone,
    mainConflict: row.main_conflict,
    mainCharacter: row.main_character,
    supportingCharacters: parseStringArray(row.supporting_characters_json),
    beginning: row.beginning,
    middle: row.middle,
    climax: row.climax,
    ending: row.ending,
    audienceEmotion: row.audience_emotion,
    hook: row.hook,
    twist: row.twist,
    cliffhanger: row.cliffhanger,
    retentionMoments: parseStringArray(row.retention_moments_json),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapScript(row: ScriptRow): Script {
  return scriptSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    notes: row.notes,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapShot(row: ShotRow): Shot {
  return shotSchema.parse({
    id: row.id,
    projectId: row.project_id,
    sceneId: row.scene_id,
    position: row.position,
    code: row.code,
    durationSeconds: row.duration_seconds,
    characters: parseStringArray(row.characters_json),
    location: row.location,
    shotType: row.shot_type,
    cameraAngle: row.camera_angle,
    lens: row.lens,
    cameraMovement: row.camera_movement,
    action: row.action,
    lighting: row.lighting,
    emotion: row.emotion,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapScene(row: SceneRow, shots: Shot[]): Scene {
  return sceneSchema.parse({
    id: row.id,
    projectId: row.project_id,
    scriptId: row.script_id,
    position: row.position,
    sceneNumber: row.scene_number,
    location: row.location,
    timeOfDay: row.time_of_day,
    characters: parseStringArray(row.characters_json),
    action: row.action,
    narration: row.narration,
    dialogue: row.dialogue,
    estimatedDurationSeconds: row.estimated_duration_seconds,
    emotionalPurpose: row.emotional_purpose,
    shots,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class StoryPlanRepository {
  constructor(
    private readonly manager: DatabaseManager,
    private readonly projects: ProjectRepository,
  ) {}

  get(projectId: string): StoryPlan | undefined {
    const storyRow = this.manager.connection
      .prepare("SELECT * FROM stories WHERE project_id = ?")
      .get(projectId) as StoryRow | undefined;
    const scriptRow = this.manager.connection
      .prepare("SELECT * FROM scripts WHERE project_id = ?")
      .get(projectId) as ScriptRow | undefined;
    if (!storyRow && !scriptRow) return undefined;
    if (!storyRow || !scriptRow) {
      throw new Error("Story plan database invariant failed.");
    }

    const sceneRows = this.manager.connection
      .prepare("SELECT * FROM scenes WHERE project_id = ? ORDER BY position")
      .all(projectId) as SceneRow[];
    const shotRows = this.manager.connection
      .prepare(
        "SELECT * FROM shots WHERE project_id = ? ORDER BY scene_id, position",
      )
      .all(projectId) as ShotRow[];
    const shotsByScene = new Map<string, Shot[]>();
    for (const row of shotRows) {
      const shots = shotsByScene.get(row.scene_id) ?? [];
      shots.push(mapShot(row));
      shotsByScene.set(row.scene_id, shots);
    }
    const scenes = sceneRows.map((row) =>
      mapScene(row, shotsByScene.get(row.id) ?? []),
    );
    const shots = scenes.flatMap((scene) => scene.shots);
    return storyPlanSchema.parse({
      story: mapStory(storyRow),
      script: mapScript(scriptRow),
      scenes,
      totals: {
        scenes: scenes.length,
        shots: shots.length,
        shotDurationSeconds: shots.reduce(
          (total, shot) => total + shot.durationSeconds,
          0,
        ),
      },
    });
  }

  save(projectId: string, input: StoryPlanInput): StoryPlan {
    const plan = storyPlanInputSchema.parse(input);
    const project = this.projects.getById(projectId);
    if (!project) throw new StoryPlanProjectNotFoundError(projectId);
    const shotDurationSeconds = plan.scenes.reduce(
      (planTotal, scene) =>
        planTotal +
        scene.shots.reduce(
          (sceneTotal, shot) => sceneTotal + shot.durationSeconds,
          0,
        ),
      0,
    );
    const maximumDurationSeconds = project.type === "reel" ? 90 : 1500;
    if (shotDurationSeconds > maximumDurationSeconds) {
      throw new StoryPlanDurationError(
        shotDurationSeconds,
        maximumDurationSeconds,
      );
    }
    const existingStory = this.manager.connection
      .prepare(
        "SELECT id, version, created_at FROM stories WHERE project_id = ?",
      )
      .get(projectId) as
      { id: string; version: number; created_at: string } | undefined;
    const existingScript = this.manager.connection
      .prepare(
        "SELECT id, version, created_at FROM scripts WHERE project_id = ?",
      )
      .get(projectId) as
      { id: string; version: number; created_at: string } | undefined;
    const timestamp = new Date().toISOString();
    const storyId = existingStory?.id ?? randomUUID();
    const scriptId = existingScript?.id ?? randomUUID();

    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `INSERT INTO stories (
            id, project_id, title, logline, genre, theme, tone, main_conflict,
            main_character, supporting_characters_json, beginning, middle,
            climax, ending, audience_emotion, hook, twist, cliffhanger,
            retention_moments_json, version, created_at, updated_at
          ) VALUES (
            @id, @projectId, @title, @logline, @genre, @theme, @tone,
            @mainConflict, @mainCharacter, @supportingCharactersJson,
            @beginning, @middle, @climax, @ending, @audienceEmotion,
            @hook, @twist, @cliffhanger, @retentionMomentsJson,
            @version, @createdAt, @updatedAt
          ) ON CONFLICT(project_id) DO UPDATE SET
            title=excluded.title, logline=excluded.logline, genre=excluded.genre,
            theme=excluded.theme, tone=excluded.tone,
            main_conflict=excluded.main_conflict,
            main_character=excluded.main_character,
            supporting_characters_json=excluded.supporting_characters_json,
            beginning=excluded.beginning, middle=excluded.middle,
            climax=excluded.climax, ending=excluded.ending,
            audience_emotion=excluded.audience_emotion, hook=excluded.hook,
            twist=excluded.twist, cliffhanger=excluded.cliffhanger,
            retention_moments_json=excluded.retention_moments_json,
            version=excluded.version, updated_at=excluded.updated_at`,
        )
        .run({
          id: storyId,
          projectId,
          ...plan.story,
          supportingCharactersJson: JSON.stringify(
            plan.story.supportingCharacters,
          ),
          retentionMomentsJson: JSON.stringify(plan.story.retentionMoments),
          hook: plan.story.hook ?? null,
          twist: plan.story.twist ?? null,
          cliffhanger: plan.story.cliffhanger ?? null,
          version: (existingStory?.version ?? 0) + 1,
          createdAt: existingStory?.created_at ?? timestamp,
          updatedAt: timestamp,
        });

      this.manager.connection
        .prepare(
          `INSERT INTO scripts (
            id, project_id, title, notes, version, created_at, updated_at
          ) VALUES (
            @id, @projectId, @title, @notes, @version, @createdAt, @updatedAt
          ) ON CONFLICT(project_id) DO UPDATE SET
            title=excluded.title, notes=excluded.notes, version=excluded.version,
            updated_at=excluded.updated_at`,
        )
        .run({
          id: scriptId,
          projectId,
          title: plan.script.title,
          notes: plan.script.notes ?? null,
          version: (existingScript?.version ?? 0) + 1,
          createdAt: existingScript?.created_at ?? timestamp,
          updatedAt: timestamp,
        });

      this.manager.connection
        .prepare("DELETE FROM scenes WHERE project_id = ?")
        .run(projectId);
      const insertScene = this.manager.connection.prepare(
        `INSERT INTO scenes (
          id, project_id, script_id, position, scene_number, location,
          time_of_day, characters_json, action, narration, dialogue,
          estimated_duration_seconds, emotional_purpose, created_at, updated_at
        ) VALUES (
          @id, @projectId, @scriptId, @position, @sceneNumber, @location,
          @timeOfDay, @charactersJson, @action, @narration, @dialogue,
          @estimatedDurationSeconds, @emotionalPurpose, @createdAt, @updatedAt
        )`,
      );
      const insertShot = this.manager.connection.prepare(
        `INSERT INTO shots (
          id, project_id, scene_id, position, code, duration_seconds,
          characters_json, location, shot_type, camera_angle, lens,
          camera_movement, action, lighting, emotion, status, created_at, updated_at
        ) VALUES (
          @id, @projectId, @sceneId, @position, @code, @durationSeconds,
          @charactersJson, @location, @shotType, @cameraAngle, @lens,
          @cameraMovement, @action, @lighting, @emotion, @status,
          @createdAt, @updatedAt
        )`,
      );

      let globalShotPosition = 0;
      plan.scenes.forEach((scene, position) => {
        const sceneId = randomUUID();
        insertScene.run({
          id: sceneId,
          projectId,
          scriptId,
          position,
          ...scene,
          charactersJson: JSON.stringify(scene.characters),
          narration: scene.narration ?? null,
          dialogue: scene.dialogue ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        scene.shots.forEach((shot, shotPosition) => {
          globalShotPosition += 1;
          insertShot.run({
            id: randomUUID(),
            projectId,
            sceneId,
            position: shotPosition,
            ...shot,
            code:
              shot.code ??
              `SHOT_${String(globalShotPosition).padStart(3, "0")}`,
            status: shot.status ?? "draft",
            charactersJson: JSON.stringify(shot.characters),
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        });
      });
      this.projects.markManifestDirty(projectId);
    })();

    const saved = this.get(projectId);
    if (!saved) throw new Error("Story plan failed to persist.");
    return saved;
  }
}

export class StoryPlanProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} was not found.`);
    this.name = "StoryPlanProjectNotFoundError";
  }
}

export class StoryPlanDurationError extends Error {
  constructor(
    readonly durationSeconds: number,
    readonly maximumSeconds: number,
  ) {
    super(
      `Shot duration totals ${durationSeconds} seconds; this project allows at most ${maximumSeconds}.`,
    );
    this.name = "StoryPlanDurationError";
  }
}
