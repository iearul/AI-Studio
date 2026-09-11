import {
  referenceCoverageSchema,
  type Bible,
  type Character,
  type Location,
  type Project,
  type Prop,
  type ReferenceCoverage,
  type ReferenceOwnerType,
  type Shot,
  type StoryPlan,
} from "@ai-film-studio/contracts";

type NamedEntity = Character | Location | Prop;

function key(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function indexEntities<T extends NamedEntity>(entities: T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const entity of entities) {
    index.set(key(entity.name), entity);
    index.set(key(entity.code), entity);
  }
  return index;
}

function resolveMany<T extends NamedEntity>(
  values: string[],
  index: Map<string, T>,
  ownerType: ReferenceOwnerType,
): {
  resolved: T[];
  unresolved: Array<{ ownerType: ReferenceOwnerType; value: string }>;
} {
  const resolved: T[] = [];
  const unresolved: Array<{ ownerType: ReferenceOwnerType; value: string }> =
    [];
  for (const value of values) {
    const entity = index.get(key(value));
    if (entity) resolved.push(entity);
    else unresolved.push({ ownerType, value });
  }
  return { resolved, unresolved };
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function characterDescription(character: Character): string {
  return compact([
    `${character.name} (${character.code})`,
    character.age === null ? undefined : `age ${character.age}`,
    character.gender || undefined,
    character.culturalAppearance || undefined,
    character.faceDescription || undefined,
    character.hair ? `hair: ${character.hair}` : undefined,
    character.eyes ? `eyes: ${character.eyes}` : undefined,
    character.skin ? `skin: ${character.skin}` : undefined,
    character.height ? `height: ${character.height}` : undefined,
    character.bodyType ? `build: ${character.bodyType}` : undefined,
    character.defaultClothing.length > 0
      ? `default clothing: ${character.defaultClothing.join(", ")}`
      : undefined,
    character.accessories.length > 0
      ? `accessories: ${character.accessories.join(", ")}`
      : undefined,
  ]).join("; ");
}

function locationDescription(location: Location): string {
  return compact([
    `${location.name} (${location.code})`,
    location.type || undefined,
    location.countryCulture || undefined,
    location.description || undefined,
    location.architecture
      ? `architecture: ${location.architecture}`
      : undefined,
    location.materials.length > 0
      ? `materials: ${location.materials.join(", ")}`
      : undefined,
    location.furniture.length > 0
      ? `furniture: ${location.furniture.join(", ")}`
      : undefined,
    location.colorPalette.length > 0
      ? `palette: ${location.colorPalette.join(", ")}`
      : undefined,
    location.periodDetails ? `period: ${location.periodDetails}` : undefined,
  ]).join("; ");
}

function propDescription(prop: Prop): string {
  return compact([
    `${prop.name} (${prop.code})`,
    prop.description || undefined,
    prop.materials.length > 0
      ? `materials: ${prop.materials.join(", ")}`
      : undefined,
    prop.colors.length > 0 ? `colors: ${prop.colors.join(", ")}` : undefined,
    prop.continuityNotes ? `continuity: ${prop.continuityNotes}` : undefined,
  ]).join("; ");
}

function referencePaths(entities: NamedEntity[]): string[] {
  return entities.flatMap((entity) =>
    entity.references.map(
      (reference) =>
        `${entity.name} (${entity.code}) — ${reference.view} view — upload ${reference.originalFilename}`,
    ),
  );
}

function buildPrompt(input: {
  project: Project;
  shot: Shot;
  characters: Character[];
  location: Location | null;
  props: Prop[];
}): string {
  const { project, shot, characters, location, props } = input;
  const paths = referencePaths([
    ...characters,
    ...(location ? [location] : []),
    ...props,
  ]);
  return compact([
    "Create exactly one finished still image for this film shot. This prompt is ready for ChatGPT Images or Gemini image generation.",
    `SHOT: ${shot.code}`,
    `ACTION: ${shot.action}`,
    `CAMERA: ${shot.shotType}, ${shot.cameraAngle}, ${shot.lens}, ${shot.cameraMovement}`,
    `FRAME: ${project.aspectRatio} aspect ratio; compose for the complete final frame with no later crop required`,
    `LIGHTING: ${shot.lighting}`,
    `EMOTION: ${shot.emotion}`,
    project.visualStyle
      ? `PROJECT VISUAL STYLE: ${project.visualStyle}`
      : undefined,
    characters.length > 0
      ? `CHARACTER CONTINUITY:\n${characters.map(characterDescription).join("\n")}`
      : undefined,
    location
      ? `LOCATION CONTINUITY:\n${locationDescription(location)}`
      : undefined,
    props.length > 0
      ? `PROP CONTINUITY:\n${props.map(propDescription).join("\n")}`
      : undefined,
    paths.length > 0
      ? `REFERENCE IMAGES TO UPLOAD WITH THIS PROMPT:\n${paths.join("\n")}`
      : "REFERENCE IMAGES TO UPLOAD WITH THIS PROMPT: none supplied yet",
    "GENERATION RULES:\n- Preserve the exact identity, apparent age, proportions, wardrobe, geography, architecture, materials, colors, markings, and recurring-object condition defined above\n- Depict only the single visible action at its clearest, strongest instant\n- Treat camera movement as motion intent, but return a sharp still frame rather than motion blur\n- Keep hands, faces, anatomy, eyelines, scale, shadows, reflections, and object contact physically coherent\n- Match the project medium and visual style; do not add unrelated people, objects, or scenery\n- Do not add text, subtitles, logos, borders, split panels, contact sheets, signatures, or watermarks",
    "OUTPUT: Return only one final image with no written explanation.",
  ]).join("\n\n");
}

export function buildReferenceCoverage(
  project: Project,
  plan: StoryPlan | undefined,
  bible: Bible,
): ReferenceCoverage {
  if (!plan) {
    return {
      shots: [],
      totals: { shots: 0, ready: 0, unresolved: 0, withoutImages: 0 },
    };
  }
  const characters = indexEntities(bible.characters);
  const locations = indexEntities(bible.locations);
  const props = indexEntities(bible.props);
  const shots = plan.scenes.flatMap((scene) =>
    scene.shots.map((shot) => {
      const resolvedCharacters = resolveMany(
        shot.characters,
        characters,
        "character",
      );
      const resolvedLocation = locations.get(key(shot.location)) ?? null;
      const resolvedProps = resolveMany(shot.props, props, "prop");
      const unresolved = [
        ...resolvedCharacters.unresolved,
        ...(resolvedLocation
          ? []
          : [{ ownerType: "location" as const, value: shot.location }]),
        ...resolvedProps.unresolved,
      ];
      const matched: NamedEntity[] = [
        ...resolvedCharacters.resolved,
        ...(resolvedLocation ? [resolvedLocation] : []),
        ...resolvedProps.resolved,
      ];
      const warnings = matched
        .filter((entity) => entity.references.length === 0)
        .map((entity) => `${entity.name} has no reference image yet.`);
      return {
        shotId: shot.id,
        shotCode: shot.code,
        ready: unresolved.length === 0,
        characters: resolvedCharacters.resolved,
        location: resolvedLocation,
        props: resolvedProps.resolved,
        unresolved,
        warnings,
        prompt: buildPrompt({
          project,
          shot,
          characters: resolvedCharacters.resolved,
          location: resolvedLocation,
          props: resolvedProps.resolved,
        }),
      };
    }),
  );
  return referenceCoverageSchema.parse({
    shots,
    totals: {
      shots: shots.length,
      ready: shots.filter((shot) => shot.ready).length,
      unresolved: shots.reduce(
        (total, shot) => total + shot.unresolved.length,
        0,
      ),
      withoutImages: shots.reduce(
        (total, shot) => total + shot.warnings.length,
        0,
      ),
    },
  });
}
