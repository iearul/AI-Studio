import { randomUUID } from "node:crypto";

import {
  bibleSchema,
  characterInputSchema,
  characterSchema,
  createReferenceImageSchema,
  locationInputSchema,
  locationSchema,
  propInputSchema,
  propSchema,
  referenceImageSchema,
  storyPlanInputSchema,
  type Bible,
  type Character,
  type CharacterInput,
  type CreateReferenceImage,
  type Location,
  type LocationInput,
  type Prop,
  type PropInput,
  type ReferenceImage,
  type ReferenceOwnerType,
  type StoryPlanInput,
} from "@ai-studio/contracts";

import type { DatabaseManager } from "./database-manager.js";
import type { ProjectRepository } from "./project-repository.js";

type CharacterRow = {
  id: string;
  project_id: string;
  code: string;
  name: string;
  age: number | null;
  gender: string;
  cultural_appearance: string;
  face_description: string;
  hair: string;
  eyes: string;
  skin: string;
  height: string;
  body_type: string;
  default_clothing_json: string;
  alternative_clothing_json: string;
  accessories_json: string;
  personality: string;
  voice: string;
  speech_style: string;
  created_at: string;
  updated_at: string;
};

type LocationRow = {
  id: string;
  project_id: string;
  code: string;
  name: string;
  country_culture: string;
  type: string;
  description: string;
  architecture: string;
  materials_json: string;
  furniture_json: string;
  default_lighting: string;
  color_palette_json: string;
  nearby_environment: string;
  period_details: string;
  created_at: string;
  updated_at: string;
};

type PropRow = {
  id: string;
  project_id: string;
  code: string;
  name: string;
  description: string;
  materials_json: string;
  colors_json: string;
  significance: string;
  continuity_notes: string;
  created_at: string;
  updated_at: string;
};

type ReferenceRow = {
  id: string;
  project_id: string;
  owner_type: ReferenceOwnerType;
  owner_id: string;
  view: string;
  original_filename: string;
  relative_path: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  created_at: string;
};

type EntityTable = "characters" | "locations" | "props";

export type BibleSyncSummary = {
  created: { characters: number; locations: number; props: number };
  enriched: { characters: number; locations: number; props: number };
};

function parseStringArray(json: string): string[] {
  const parsed = JSON.parse(json) as unknown;
  if (
    !Array.isArray(parsed) ||
    !parsed.every((value) => typeof value === "string")
  ) {
    throw new Error("Database JSON array invariant failed.");
  }
  return parsed;
}

function mapReference(row: ReferenceRow): ReferenceImage {
  return referenceImageSchema.parse({
    id: row.id,
    projectId: row.project_id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    view: row.view,
    originalFilename: row.original_filename,
    relativePath: row.relative_path,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    createdAt: row.created_at,
  });
}

function mapCharacter(
  row: CharacterRow,
  references: ReferenceImage[],
): Character {
  return characterSchema.parse({
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    age: row.age,
    gender: row.gender,
    culturalAppearance: row.cultural_appearance,
    faceDescription: row.face_description,
    hair: row.hair,
    eyes: row.eyes,
    skin: row.skin,
    height: row.height,
    bodyType: row.body_type,
    defaultClothing: parseStringArray(row.default_clothing_json),
    alternativeClothing: parseStringArray(row.alternative_clothing_json),
    accessories: parseStringArray(row.accessories_json),
    personality: row.personality,
    voice: row.voice,
    speechStyle: row.speech_style,
    references,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapLocation(row: LocationRow, references: ReferenceImage[]): Location {
  return locationSchema.parse({
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    countryCulture: row.country_culture,
    type: row.type,
    description: row.description,
    architecture: row.architecture,
    materials: parseStringArray(row.materials_json),
    furniture: parseStringArray(row.furniture_json),
    defaultLighting: row.default_lighting,
    colorPalette: parseStringArray(row.color_palette_json),
    nearbyEnvironment: row.nearby_environment,
    periodDetails: row.period_details,
    references,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapProp(row: PropRow, references: ReferenceImage[]): Prop {
  return propSchema.parse({
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    description: row.description,
    materials: parseStringArray(row.materials_json),
    colors: parseStringArray(row.colors_json),
    significance: row.significance,
    continuityNotes: row.continuity_notes,
    references,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function referencesByOwner(
  rows: ReferenceRow[],
): Map<string, ReferenceImage[]> {
  const result = new Map<string, ReferenceImage[]>();
  for (const row of rows) {
    const reference = mapReference(row);
    const key = `${reference.ownerType}:${reference.ownerId}`;
    const values = result.get(key) ?? [];
    values.push(reference);
    result.set(key, values);
  }
  return result;
}

function nameKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function addNamed<T extends { name: string }>(
  values: Map<string, T>,
  value: T,
): void {
  const key = nameKey(value.name);
  if (key && !values.has(key)) values.set(key, value);
}

function fillText(current: string, generated: string): string {
  return current.trim() ? current : generated;
}

function fillList(current: string[], generated: string[]): string[] {
  return current.length > 0 ? current : generated;
}

function mergeCharacter(
  current: Character,
  generated: CharacterInput,
): CharacterInput {
  const next = characterInputSchema.parse(generated);
  return {
    name: current.name,
    age: current.age ?? next.age,
    gender: fillText(current.gender, next.gender),
    culturalAppearance: fillText(
      current.culturalAppearance,
      next.culturalAppearance,
    ),
    faceDescription: fillText(current.faceDescription, next.faceDescription),
    hair: fillText(current.hair, next.hair),
    eyes: fillText(current.eyes, next.eyes),
    skin: fillText(current.skin, next.skin),
    height: fillText(current.height, next.height),
    bodyType: fillText(current.bodyType, next.bodyType),
    defaultClothing: fillList(current.defaultClothing, next.defaultClothing),
    alternativeClothing: fillList(
      current.alternativeClothing,
      next.alternativeClothing,
    ),
    accessories: fillList(current.accessories, next.accessories),
    personality: fillText(current.personality, next.personality),
    voice: fillText(current.voice, next.voice),
    speechStyle: fillText(current.speechStyle, next.speechStyle),
  };
}

function mergeLocation(
  current: Location,
  generated: LocationInput,
): LocationInput {
  const next = locationInputSchema.parse(generated);
  return {
    name: current.name,
    countryCulture: fillText(current.countryCulture, next.countryCulture),
    type: fillText(current.type, next.type),
    description: fillText(current.description, next.description),
    architecture: fillText(current.architecture, next.architecture),
    materials: fillList(current.materials, next.materials),
    furniture: fillList(current.furniture, next.furniture),
    defaultLighting: fillText(current.defaultLighting, next.defaultLighting),
    colorPalette: fillList(current.colorPalette, next.colorPalette),
    nearbyEnvironment: fillText(
      current.nearbyEnvironment,
      next.nearbyEnvironment,
    ),
    periodDetails: fillText(current.periodDetails, next.periodDetails),
  };
}

function mergeProp(current: Prop, generated: PropInput): PropInput {
  const next = propInputSchema.parse(generated);
  return {
    name: current.name,
    description: fillText(current.description, next.description),
    materials: fillList(current.materials, next.materials),
    colors: fillList(current.colors, next.colors),
    significance: fillText(current.significance, next.significance),
    continuityNotes: fillText(current.continuityNotes, next.continuityNotes),
  };
}

function changed<T>(current: T, next: T): boolean {
  return JSON.stringify(current) !== JSON.stringify(next);
}

export class BibleRepository {
  constructor(
    private readonly manager: DatabaseManager,
    private readonly projects: ProjectRepository,
  ) {}

  list(projectId: string): Bible {
    this.assertProject(projectId);
    const referenceRows = this.manager.connection
      .prepare(
        "SELECT * FROM reference_images WHERE project_id = ? ORDER BY created_at, id",
      )
      .all(projectId) as ReferenceRow[];
    const references = referencesByOwner(referenceRows);
    const characters = (
      this.manager.connection
        .prepare(
          "SELECT * FROM characters WHERE project_id = ? ORDER BY name COLLATE NOCASE",
        )
        .all(projectId) as CharacterRow[]
    ).map((row) =>
      mapCharacter(row, references.get(`character:${row.id}`) ?? []),
    );
    const locations = (
      this.manager.connection
        .prepare(
          "SELECT * FROM locations WHERE project_id = ? ORDER BY name COLLATE NOCASE",
        )
        .all(projectId) as LocationRow[]
    ).map((row) =>
      mapLocation(row, references.get(`location:${row.id}`) ?? []),
    );
    const props = (
      this.manager.connection
        .prepare(
          "SELECT * FROM props WHERE project_id = ? ORDER BY name COLLATE NOCASE",
        )
        .all(projectId) as PropRow[]
    ).map((row) => mapProp(row, references.get(`prop:${row.id}`) ?? []));
    return bibleSchema.parse({ characters, locations, props });
  }

  syncStoryEntities(
    projectId: string,
    input: StoryPlanInput,
  ): BibleSyncSummary {
    this.assertProject(projectId);
    const plan = storyPlanInputSchema.parse(input);
    const supplied = plan.visualBible ?? {
      characters: [],
      locations: [],
      props: [],
    };
    const characters = new Map<string, CharacterInput>();
    const locations = new Map<string, LocationInput>();
    const props = new Map<string, PropInput>();

    supplied.characters.forEach((value) =>
      addNamed(characters, characterInputSchema.parse(value)),
    );
    supplied.locations.forEach((value) =>
      addNamed(locations, locationInputSchema.parse(value)),
    );
    supplied.props.forEach((value) =>
      addNamed(props, propInputSchema.parse(value)),
    );

    const addCharacterName = (name: string) => {
      if (name.trim().length < 2) return;
      const value = characterInputSchema.parse({ name });
      const existing = characters.get(nameKey(name));
      if (!existing) addNamed(characters, value);
    };
    const addLocationName = (name: string) => {
      if (name.trim().length < 2) return;
      const value = locationInputSchema.parse({ name });
      const existing = locations.get(nameKey(name));
      if (!existing) addNamed(locations, value);
    };
    const addPropName = (name: string) => {
      if (name.trim().length < 2) return;
      const value = propInputSchema.parse({ name });
      const existing = props.get(nameKey(name));
      if (!existing) addNamed(props, value);
    };

    addCharacterName(plan.story.mainCharacter);
    plan.story.supportingCharacters.forEach(addCharacterName);
    for (const scene of plan.scenes) {
      addLocationName(scene.location);
      scene.characters.forEach(addCharacterName);
      for (const shot of scene.shots) {
        addLocationName(shot.location);
        shot.characters.forEach(addCharacterName);
        shot.props.forEach(addPropName);
      }
    }

    const summary: BibleSyncSummary = {
      created: { characters: 0, locations: 0, props: 0 },
      enriched: { characters: 0, locations: 0, props: 0 },
    };
    const current = this.list(projectId);
    const currentCharacters = new Map(
      current.characters.map((entity) => [nameKey(entity.name), entity]),
    );
    const currentLocations = new Map(
      current.locations.map((entity) => [nameKey(entity.name), entity]),
    );
    const currentProps = new Map(
      current.props.map((entity) => [nameKey(entity.name), entity]),
    );

    for (const value of characters.values()) {
      const existing = currentCharacters.get(nameKey(value.name));
      if (!existing) {
        this.createCharacter(projectId, value);
        summary.created.characters += 1;
        continue;
      }
      const currentInput = characterInputSchema.parse(existing);
      const merged = mergeCharacter(existing, value);
      if (changed(currentInput, merged)) {
        this.updateCharacter(projectId, existing.id, merged);
        summary.enriched.characters += 1;
      }
    }
    for (const value of locations.values()) {
      const existing = currentLocations.get(nameKey(value.name));
      if (!existing) {
        this.createLocation(projectId, value);
        summary.created.locations += 1;
        continue;
      }
      const currentInput = locationInputSchema.parse(existing);
      const merged = mergeLocation(existing, value);
      if (changed(currentInput, merged)) {
        this.updateLocation(projectId, existing.id, merged);
        summary.enriched.locations += 1;
      }
    }
    for (const value of props.values()) {
      const existing = currentProps.get(nameKey(value.name));
      if (!existing) {
        this.createProp(projectId, value);
        summary.created.props += 1;
        continue;
      }
      const currentInput = propInputSchema.parse(existing);
      const merged = mergeProp(existing, value);
      if (changed(currentInput, merged)) {
        this.updateProp(projectId, existing.id, merged);
        summary.enriched.props += 1;
      }
    }

    return summary;
  }

  createCharacter(projectId: string, input: CharacterInput): Character {
    const value = characterInputSchema.parse(input);
    this.assertProject(projectId);
    this.assertNameAvailable("characters", projectId, value.name);
    const timestamp = new Date().toISOString();
    const id = randomUUID();
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `INSERT INTO characters (
            id, project_id, code, name, age, gender, cultural_appearance,
            face_description, hair, eyes, skin, height, body_type,
            default_clothing_json, alternative_clothing_json,
            accessories_json, personality, voice, speech_style,
            created_at, updated_at
          ) VALUES (
            @id, @projectId, @code, @name, @age, @gender,
            @culturalAppearance, @faceDescription, @hair, @eyes, @skin,
            @height, @bodyType, @defaultClothingJson,
            @alternativeClothingJson, @accessoriesJson, @personality,
            @voice, @speechStyle, @createdAt, @updatedAt
          )`,
        )
        .run({
          id,
          projectId,
          code: this.nextCode("characters", "CHAR", projectId, value.name),
          ...value,
          defaultClothingJson: JSON.stringify(value.defaultClothing),
          alternativeClothingJson: JSON.stringify(value.alternativeClothing),
          accessoriesJson: JSON.stringify(value.accessories),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireCharacter(projectId, id);
  }

  updateCharacter(
    projectId: string,
    id: string,
    input: CharacterInput,
  ): Character {
    const value = characterInputSchema.parse(input);
    this.requireCharacter(projectId, id);
    this.assertNameAvailable("characters", projectId, value.name, id);
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `UPDATE characters SET
            name=@name, age=@age, gender=@gender,
            cultural_appearance=@culturalAppearance,
            face_description=@faceDescription, hair=@hair, eyes=@eyes,
            skin=@skin, height=@height, body_type=@bodyType,
            default_clothing_json=@defaultClothingJson,
            alternative_clothing_json=@alternativeClothingJson,
            accessories_json=@accessoriesJson, personality=@personality,
            voice=@voice, speech_style=@speechStyle, updated_at=@updatedAt
          WHERE id=@id AND project_id=@projectId`,
        )
        .run({
          id,
          projectId,
          ...value,
          defaultClothingJson: JSON.stringify(value.defaultClothing),
          alternativeClothingJson: JSON.stringify(value.alternativeClothing),
          accessoriesJson: JSON.stringify(value.accessories),
          updatedAt: new Date().toISOString(),
        });
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireCharacter(projectId, id);
  }

  createLocation(projectId: string, input: LocationInput): Location {
    const value = locationInputSchema.parse(input);
    this.assertProject(projectId);
    this.assertNameAvailable("locations", projectId, value.name);
    const timestamp = new Date().toISOString();
    const id = randomUUID();
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `INSERT INTO locations (
            id, project_id, code, name, country_culture, type, description,
            architecture, materials_json, furniture_json, default_lighting,
            color_palette_json, nearby_environment, period_details,
            created_at, updated_at
          ) VALUES (
            @id, @projectId, @code, @name, @countryCulture, @type,
            @description, @architecture, @materialsJson, @furnitureJson,
            @defaultLighting, @colorPaletteJson, @nearbyEnvironment,
            @periodDetails, @createdAt, @updatedAt
          )`,
        )
        .run({
          id,
          projectId,
          code: this.nextCode("locations", "LOC", projectId, value.name),
          ...value,
          materialsJson: JSON.stringify(value.materials),
          furnitureJson: JSON.stringify(value.furniture),
          colorPaletteJson: JSON.stringify(value.colorPalette),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireLocation(projectId, id);
  }

  updateLocation(
    projectId: string,
    id: string,
    input: LocationInput,
  ): Location {
    const value = locationInputSchema.parse(input);
    this.requireLocation(projectId, id);
    this.assertNameAvailable("locations", projectId, value.name, id);
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `UPDATE locations SET
            name=@name, country_culture=@countryCulture, type=@type,
            description=@description, architecture=@architecture,
            materials_json=@materialsJson, furniture_json=@furnitureJson,
            default_lighting=@defaultLighting,
            color_palette_json=@colorPaletteJson,
            nearby_environment=@nearbyEnvironment,
            period_details=@periodDetails, updated_at=@updatedAt
          WHERE id=@id AND project_id=@projectId`,
        )
        .run({
          id,
          projectId,
          ...value,
          materialsJson: JSON.stringify(value.materials),
          furnitureJson: JSON.stringify(value.furniture),
          colorPaletteJson: JSON.stringify(value.colorPalette),
          updatedAt: new Date().toISOString(),
        });
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireLocation(projectId, id);
  }

  createProp(projectId: string, input: PropInput): Prop {
    const value = propInputSchema.parse(input);
    this.assertProject(projectId);
    this.assertNameAvailable("props", projectId, value.name);
    const timestamp = new Date().toISOString();
    const id = randomUUID();
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `INSERT INTO props (
            id, project_id, code, name, description, materials_json,
            colors_json, significance, continuity_notes, created_at, updated_at
          ) VALUES (
            @id, @projectId, @code, @name, @description, @materialsJson,
            @colorsJson, @significance, @continuityNotes, @createdAt, @updatedAt
          )`,
        )
        .run({
          id,
          projectId,
          code: this.nextCode("props", "PROP", projectId, value.name),
          ...value,
          materialsJson: JSON.stringify(value.materials),
          colorsJson: JSON.stringify(value.colors),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireProp(projectId, id);
  }

  updateProp(projectId: string, id: string, input: PropInput): Prop {
    const value = propInputSchema.parse(input);
    this.requireProp(projectId, id);
    this.assertNameAvailable("props", projectId, value.name, id);
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `UPDATE props SET
            name=@name, description=@description, materials_json=@materialsJson,
            colors_json=@colorsJson, significance=@significance,
            continuity_notes=@continuityNotes, updated_at=@updatedAt
          WHERE id=@id AND project_id=@projectId`,
        )
        .run({
          id,
          projectId,
          ...value,
          materialsJson: JSON.stringify(value.materials),
          colorsJson: JSON.stringify(value.colors),
          updatedAt: new Date().toISOString(),
        });
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireProp(projectId, id);
  }

  addReference(projectId: string, input: CreateReferenceImage): ReferenceImage {
    const value = createReferenceImageSchema.parse(input);
    this.assertProject(projectId);
    this.assertOwner(projectId, value.ownerType, value.ownerId);
    const reference = referenceImageSchema.parse({
      id: randomUUID(),
      projectId,
      ...value,
      createdAt: new Date().toISOString(),
    });
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `INSERT INTO reference_images (
            id, project_id, owner_type, owner_id, view, original_filename,
            relative_path, mime_type, byte_size, sha256, created_at
          ) VALUES (
            @id, @projectId, @ownerType, @ownerId, @view, @originalFilename,
            @relativePath, @mimeType, @byteSize, @sha256, @createdAt
          )`,
        )
        .run(reference);
      this.projects.markManifestDirty(projectId);
    })();
    return reference;
  }

  getReference(projectId: string, id: string): ReferenceImage | undefined {
    const row = this.manager.connection
      .prepare("SELECT * FROM reference_images WHERE project_id = ? AND id = ?")
      .get(projectId, id) as ReferenceRow | undefined;
    return row ? mapReference(row) : undefined;
  }

  private requireCharacter(projectId: string, id: string): Character {
    const bible = this.list(projectId);
    const entity = bible.characters.find((character) => character.id === id);
    if (!entity) throw new BibleEntityNotFoundError("Character");
    return entity;
  }

  private requireLocation(projectId: string, id: string): Location {
    const bible = this.list(projectId);
    const entity = bible.locations.find((location) => location.id === id);
    if (!entity) throw new BibleEntityNotFoundError("Location");
    return entity;
  }

  private requireProp(projectId: string, id: string): Prop {
    const bible = this.list(projectId);
    const entity = bible.props.find((prop) => prop.id === id);
    if (!entity) throw new BibleEntityNotFoundError("Prop");
    return entity;
  }

  private assertOwner(
    projectId: string,
    ownerType: ReferenceOwnerType,
    ownerId: string,
  ): void {
    const table: EntityTable =
      ownerType === "character"
        ? "characters"
        : ownerType === "location"
          ? "locations"
          : "props";
    const row = this.manager.connection
      .prepare(`SELECT 1 FROM ${table} WHERE project_id = ? AND id = ?`)
      .get(projectId, ownerId);
    if (!row) throw new BibleEntityNotFoundError(ownerType);
  }

  private assertProject(projectId: string): void {
    if (!this.projects.getById(projectId)) {
      throw new BibleProjectNotFoundError(projectId);
    }
  }

  private assertNameAvailable(
    table: EntityTable,
    projectId: string,
    name: string,
    excludingId?: string,
  ): void {
    const row = this.manager.connection
      .prepare(
        `SELECT id FROM ${table}
         WHERE project_id = ? AND name = ? COLLATE NOCASE`,
      )
      .get(projectId, name) as { id: string } | undefined;
    if (row && row.id !== excludingId) {
      throw new BibleConflictError(name);
    }
  }

  private nextCode(
    table: EntityTable,
    prefix: "CHAR" | "LOC" | "PROP",
    projectId: string,
    name: string,
  ): string {
    const stem =
      name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 36) || "ITEM";
    for (let index = 1; index <= 999; index += 1) {
      const code = `${prefix}_${stem}_${String(index).padStart(3, "0")}`;
      const existing = this.manager.connection
        .prepare(`SELECT 1 FROM ${table} WHERE project_id = ? AND code = ?`)
        .get(projectId, code);
      if (!existing) return code;
    }
    throw new BibleConflictError(`No code remains for ${name}`);
  }
}

export class BibleProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} was not found.`);
    this.name = "BibleProjectNotFoundError";
  }
}

export class BibleEntityNotFoundError extends Error {
  constructor(entity: string) {
    super(`${entity} was not found in this project.`);
    this.name = "BibleEntityNotFoundError";
  }
}

export class BibleConflictError extends Error {
  constructor(value: string) {
    super(`A Bible record named ${value} already exists in this project.`);
    this.name = "BibleConflictError";
  }
}
