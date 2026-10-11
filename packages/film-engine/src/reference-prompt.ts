import {
  referencePromptSchema,
  type Bible,
  type Location,
  type Project,
  type Prop,
  type ReferenceOwnerType,
  type ReferencePrompt,
  type ReferenceView,
} from "@ai-film-studio/contracts";

import { buildCharacterReferencePrompt } from "./character-reference-prompt.js";
import {
  compact,
  detail,
  listDetail,
  referenceFilename,
} from "./prompt-text.js";

/** Composition each reference type is generated at. */
export const referenceAspectRatios: Record<
  ReferenceOwnerType,
  "4:5" | "16:9" | "1:1"
> = {
  character: "4:5",
  location: "16:9",
  prop: "1:1",
};

export const defaultReferenceViews: Record<ReferenceOwnerType, ReferenceView> =
  {
    character: "three-quarter",
    location: "exterior-day",
    prop: "three-quarter",
  };

const locationCompositionByView: Partial<Record<ReferenceView, string>> = {
  "exterior-day":
    "- Wide establishing exterior view in clear natural daylight\n- Show the full façade or landscape layout, entrances, paths, and immediate surroundings\n- Eye-level 24-35mm lens look with straight vertical lines",
  "exterior-night":
    "- Wide establishing exterior view at night\n- Light the scene only with the location's own practical, street, moon, or window light\n- Eye-level 24-35mm lens look with straight vertical lines and readable shadow detail",
  interior:
    "- Wide interior view from a corner at eye level\n- Show the room layout, walls, floor, ceiling, windows, doors, and main furniture\n- 24mm lens look without fisheye distortion",
  detail:
    "- Close detail view of the location's most distinctive materials, textures, fixtures, and signs of age\n- Keep enough context to recognize which part of the location it is",
  other:
    "- Single clear production reference view at eye level that best explains the space\n- Do not combine multiple angles or panels in one image",
};

const propCompositionByView: Partial<Record<ReferenceView, string>> = {
  front:
    "- Direct front view at eye level, with the object centered and square to camera",
  "three-quarter":
    "- Three-quarter view turned 45 degrees from camera, showing the front and one side",
  profile: "- Exact side view at the object's center height",
  detail:
    "- Close macro view of the most distinctive surface, markings, wear, mechanism, or texture",
  other:
    "- Single clear product reference view that best shows the object's shape and materials",
};

function projectHeader(project: Project): string {
  const style = project.visualStyle || project.customStyle || project.style;
  return `PROJECT: ${project.title}\nPROJECT VISUAL STYLE: ${style}\nPROJECT COUNTRY / CULTURE: ${project.countryCulture || "not specified"}`;
}

function unspecified(missing: string[]): string | null {
  return missing.length > 0
    ? `UNSPECIFIED DETAILS: Choose natural, understated values for ${missing.join(", ")} and keep those choices internally consistent within this image. This generated image will become the final source of truth for those details.`
    : null;
}

function locationMissing(location: Location): string[] {
  return compact([
    location.description ? null : "overall description",
    location.architecture ? null : "architecture",
    location.materials.length > 0 ? null : "materials",
    location.colorPalette.length > 0 ? null : "color palette",
    location.defaultLighting ? null : "default lighting",
  ]);
}

export function buildLocationReferencePrompt(
  project: Project,
  location: Location,
  view: ReferenceView = defaultReferenceViews.location,
): ReferencePrompt {
  const missing = locationMissing(location);
  const viewName = view.replaceAll("-", " ");
  const identity = compact([
    detail("Production identity", `${location.name} (${location.code})`),
    detail("Location type", location.type),
    detail("Country / culture", location.countryCulture),
    detail("Description", location.description),
    detail("Architecture", location.architecture),
    listDetail("Materials", location.materials),
    listDetail("Furniture and fixtures", location.furniture),
    listDetail("Color palette", location.colorPalette),
    detail("Nearby environment", location.nearbyEnvironment),
    detail("Period details", location.periodDetails),
  ]);
  const prompt = [
    `Create one high-detail ${viewName} location reference image for a film production. Render it as a realistic production photograph unless the project visual style below explicitly requires another medium.`,
    projectHeader(project),
    `LOCATION IDENTITY — treat every supplied detail as fixed:\n${identity.join("\n")}`,
    `COMPOSITION AND CAMERA — ${view.toUpperCase()} VIEW:\n${locationCompositionByView[view] ?? locationCompositionByView.other}\n- Landscape 16:9 composition with the whole space readable\n- Natural perspective, sharp focus throughout, no tilt-shift or miniature effect`,
    `LIGHTING:\n- ${location.defaultLighting || "Natural, motivated lighting appropriate to the view"}\n- Accurate material color, realistic exposure, restrained color grading`,
    `CONTINUITY RULES:\n- Preserve the exact layout, architecture, materials, furniture, palette, and period described above\n- This ${viewName} image will be reused as the location reference for every shot set here\n- Show the location empty and ready for a scene; do not add story action\n- Do not redesign, modernize, age, or relocate the space`,
    "DO NOT INCLUDE:\n- People, crowds, animals, or vehicles unless the description lists them as part of the place\n- Text, labels, captions, logos, signatures, borders, or watermarks\n- Split panels, collages, multiple angles, or fisheye distortion",
    unspecified(missing),
    `OUTPUT: Return only the finished ${location.name} reference image, with no explanation or text outside the image.`,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
  return referencePromptSchema.parse({
    ownerType: "location",
    ownerId: location.id,
    ownerCode: location.code,
    ownerName: location.name,
    view,
    filename: referenceFilename(location.name, view, "location"),
    prompt,
    ready: missing.length === 0,
    missingDetails: missing,
  });
}

function propMissing(prop: Prop): string[] {
  return compact([
    prop.description ? null : "shape and description",
    prop.materials.length > 0 ? null : "materials",
    prop.colors.length > 0 ? null : "colors",
  ]);
}

export function buildPropReferencePrompt(
  project: Project,
  prop: Prop,
  view: ReferenceView = defaultReferenceViews.prop,
): ReferencePrompt {
  const missing = propMissing(prop);
  const viewName = view.replaceAll("-", " ");
  const identity = compact([
    detail("Production identity", `${prop.name} (${prop.code})`),
    detail("Description", prop.description),
    listDetail("Materials", prop.materials),
    listDetail("Colors", prop.colors),
    detail("Story role (do not illustrate it)", prop.significance),
    detail("Continuity notes", prop.continuityNotes),
  ]);
  const prompt = [
    `Create one high-detail ${viewName} prop reference image for a film production. Render it as a realistic product photograph unless the project visual style below explicitly requires another medium.`,
    projectHeader(project),
    `PROP IDENTITY — treat every supplied detail as fixed:\n${identity.join("\n")}`,
    `COMPOSITION AND CAMERA — ${view.toUpperCase()} VIEW:\n${propCompositionByView[view] ?? propCompositionByView.other}\n- Exactly one object, fully visible with clean margins on every side\n- Square 1:1 composition, 50-100mm lens look with no wide-angle distortion`,
    "LIGHTING AND BACKGROUND:\n- Soft, even studio key and fill lighting with accurate color\n- Plain warm-gray seamless background with a minimal soft contact shadow\n- High detail on material texture, edges, wear, and markings",
    `CONTINUITY RULES:\n- Preserve the exact shape, proportions, materials, colors, wear, and markings described above\n- This ${viewName} image will be reused as the prop reference in every shot that shows it\n- Do not redesign, clean up, age, or restyle the object`,
    "DO NOT INCLUDE:\n- Hands, people, or other objects\n- Text, labels, captions, logos, signatures, borders, or watermarks unless they are physically part of the prop\n- Split panels, multiple angles, reflections that hide the object, or extreme depth of field",
    unspecified(missing),
    `OUTPUT: Return only the finished ${prop.name} reference image, with no explanation or text outside the image.`,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
  return referencePromptSchema.parse({
    ownerType: "prop",
    ownerId: prop.id,
    ownerCode: prop.code,
    ownerName: prop.name,
    view,
    filename: referenceFilename(prop.name, view, "prop"),
    prompt,
    ready: missing.length === 0,
    missingDetails: missing,
  });
}

/**
 * Builds the reference-photo prompt for any Visual Bible record, or returns
 * undefined when the record does not exist in the project.
 */
export function buildReferencePrompt(
  project: Project,
  bible: Bible,
  ownerType: ReferenceOwnerType,
  ownerId: string,
  view: ReferenceView = defaultReferenceViews[ownerType],
): ReferencePrompt | undefined {
  if (ownerType === "character") {
    const character = bible.characters.find((item) => item.id === ownerId);
    if (!character) return undefined;
    const built = buildCharacterReferencePrompt(project, character, view);
    return referencePromptSchema.parse({
      ownerType,
      ownerId,
      ownerCode: built.characterCode,
      ownerName: character.name,
      view: built.view,
      filename: built.filename,
      prompt: built.prompt,
      ready: built.ready,
      missingDetails: built.missingDetails,
    });
  }
  if (ownerType === "location") {
    const location = bible.locations.find((item) => item.id === ownerId);
    return location
      ? buildLocationReferencePrompt(project, location, view)
      : undefined;
  }
  const prop = bible.props.find((item) => item.id === ownerId);
  return prop ? buildPropReferencePrompt(project, prop, view) : undefined;
}
