import { randomUUID } from "node:crypto";

import {
  projectSchema,
  type CreateProjectInput,
  type Project,
  type ProjectListQuery,
  type UpdateProjectInput,
} from "@ai-film-studio/contracts";

import type { DatabaseManager } from "./database-manager.js";

type ProjectRow = {
  id: string;
  slug: string;
  title: string;
  type: string;
  topic: string;
  language: string;
  custom_language: string | null;
  target_duration_seconds: number;
  aspect_ratio: string;
  style: string;
  custom_style: string | null;
  narration: string;
  target_audience: string | null;
  tone: string | null;
  age_rating: string | null;
  country_culture: string | null;
  visual_style: string | null;
  desired_ending: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const columns = `
  id, slug, title, type, topic, language, custom_language,
  target_duration_seconds, aspect_ratio, style, custom_style, narration,
  target_audience, tone, age_rating, country_culture, visual_style,
  desired_ending, status, created_at, updated_at
`;

function toSlug(title: string, id: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${base || "project"}-${id.slice(0, 8)}`;
}

function mapProject(row: ProjectRow): Project {
  return projectSchema.parse({
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: row.type,
    topic: row.topic,
    language: row.language,
    customLanguage: row.custom_language,
    targetDurationSeconds: row.target_duration_seconds,
    aspectRatio: row.aspect_ratio,
    style: row.style,
    customStyle: row.custom_style,
    narration: row.narration,
    targetAudience: row.target_audience,
    tone: row.tone,
    ageRating: row.age_rating,
    countryCulture: row.country_culture,
    visualStyle: row.visual_style,
    desiredEnding: row.desired_ending,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class ProjectRepository {
  constructor(private readonly manager: DatabaseManager) {}

  list(query: ProjectListQuery = {}): Project[] {
    const conditions: string[] = [];
    const parameters: unknown[] = [];
    if (query.type) {
      conditions.push("type = ?");
      parameters.push(query.type);
    }
    if (query.status) {
      conditions.push("status = ?");
      parameters.push(query.status);
    }
    if (query.search) {
      conditions.push("(title LIKE ? ESCAPE '\\' OR topic LIKE ? ESCAPE '\\')");
      const escaped = query.search.replace(/[\\%_]/g, "\\$&");
      parameters.push(`%${escaped}%`, `%${escaped}%`);
    }
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.manager.connection
      .prepare(
        `SELECT ${columns} FROM projects ${where} ORDER BY updated_at DESC`,
      )
      .all(...parameters) as ProjectRow[];
    return rows.map(mapProject);
  }

  getById(id: string): Project | undefined {
    const row = this.manager.connection
      .prepare(`SELECT ${columns} FROM projects WHERE id = ?`)
      .get(id) as ProjectRow | undefined;
    return row ? mapProject(row) : undefined;
  }

  create(input: CreateProjectInput): Project {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const project = projectSchema.parse({
      ...input,
      customLanguage: input.customLanguage ?? null,
      customStyle: input.customStyle ?? null,
      targetAudience: input.targetAudience ?? null,
      tone: input.tone ?? null,
      ageRating: input.ageRating ?? null,
      countryCulture: input.countryCulture ?? null,
      visualStyle: input.visualStyle ?? null,
      desiredEnding: input.desiredEnding ?? null,
      id,
      slug: toSlug(input.title, id),
      status: "draft",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `INSERT INTO projects (
            ${columns}
          ) VALUES (
            @id, @slug, @title, @type, @topic, @language, @customLanguage,
            @targetDurationSeconds, @aspectRatio, @style, @customStyle, @narration,
            @targetAudience, @tone, @ageRating, @countryCulture, @visualStyle,
            @desiredEnding, @status, @createdAt, @updatedAt
          )`,
        )
        .run(project);
      this.queueManifest(project);
    })();
    return project;
  }

  update(id: string, input: UpdateProjectInput): Project | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;
    const project = projectSchema.parse({
      ...existing,
      ...input,
      id: existing.id,
      type: existing.type,
      slug: existing.slug,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });

    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `UPDATE projects SET
            title = @title, topic = @topic, language = @language,
            custom_language = @customLanguage,
            target_duration_seconds = @targetDurationSeconds,
            aspect_ratio = @aspectRatio, style = @style,
            custom_style = @customStyle, narration = @narration,
            target_audience = @targetAudience, tone = @tone,
            age_rating = @ageRating, country_culture = @countryCulture,
            visual_style = @visualStyle, desired_ending = @desiredEnding,
            status = @status, updated_at = @updatedAt
          WHERE id = @id`,
        )
        .run(project);
      this.queueManifest(project);
    })();
    return project;
  }

  queueAllManifests(): void {
    this.manager.connection.transaction(() => {
      for (const project of this.list()) this.queueManifest(project);
    })();
  }

  markManifestDirty(projectId: string): void {
    const project = this.getById(projectId);
    if (project) this.queueManifest(project);
  }

  private queueManifest(project: Project): void {
    this.manager.connection
      .prepare(
        `INSERT INTO manifest_outbox (
          project_id, project_json, attempts, last_error, updated_at
        ) VALUES (?, ?, 0, NULL, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          project_json = excluded.project_json,
          attempts = 0,
          last_error = NULL,
          updated_at = excluded.updated_at`,
      )
      .run(project.id, JSON.stringify(project), project.updatedAt);
  }
}
