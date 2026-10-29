import {
  characterReferencePromptSchema,
  type Character,
  type CharacterReferencePrompt,
  type Project,
  type ReferenceView,
} from "@ai-studio/contracts";

import {
  compact,
  detail,
  listDetail,
  referenceFilename,
} from "./prompt-text.js";

const compositionByView: Partial<Record<ReferenceView, string>> = {
  front:
    "- Direct front view at eye level; face, shoulders, hips, knees, and feet square to camera\n- Head-to-toe neutral standing pose with both hands visible\n- No body turn, face turn, tilt, or three-quarter angle",
  "three-quarter":
    "- Three-quarter front view at eye level, with body and face turned exactly 45 degrees from camera\n- Head-to-toe neutral standing pose with both hands visible\n- Near and far facial features remain readable; do not drift toward a front or profile view",
  profile:
    "- Exact 90-degree left-side profile at eye level\n- Head, nose, shoulders, hips, knees, and feet all remain in true side profile\n- Head-to-toe neutral standing pose with the silhouette and both feet fully visible; do not use a three-quarter angle",
  "full-body":
    "- Direct front, head-to-toe full-body view at eye level\n- Neutral anatomical standing pose with arms relaxed and separated from the torso, both hands and shoes fully visible\n- Camera far enough away to leave clean space above the hair and below the feet",
  neutral:
    "- Direct front head-and-shoulders identity portrait at eye level\n- Neutral resting expression, closed mouth, relaxed brow, direct gaze into camera\n- Crop at mid-chest while keeping all hair, ears, jawline, and shoulders visible",
  expression:
    "- Three-quarter head-and-shoulders portrait at eye level\n- Show the character's signature story-appropriate expression based on the personality description, while keeping identity fully recognizable\n- Crop at mid-chest; preserve facial proportions and avoid theatrical exaggeration",
  other:
    "- Single clear production reference view at eye level\n- Use a neutral pose and unobstructed framing that reveals identity, wardrobe, and proportions\n- Do not combine multiple angles or panels in one image",
};

function missingDetails(character: Character): string[] {
  return compact([
    character.faceDescription ? null : "face description",
    character.hair ? null : "hair",
    character.eyes ? null : "eyes",
    character.skin ? null : "skin tone and texture",
    character.bodyType ? null : "body type",
    character.defaultClothing.length > 0 ? null : "default clothing",
  ]);
}

export function buildCharacterReferencePrompt(
  project: Project,
  character: Character,
  view: ReferenceView = "three-quarter",
): CharacterReferencePrompt {
  const missing = missingDetails(character);
  const projectStyle =
    project.visualStyle || project.customStyle || project.style;
  const projectCulture = project.countryCulture || "not specified";
  const identity = compact([
    detail("Production identity", `${character.name} (${character.code})`),
    detail("Age", character.age),
    detail("Gender presentation", character.gender),
    detail("Cultural appearance", character.culturalAppearance),
    detail("Face", character.faceDescription),
    detail("Hair", character.hair),
    detail("Eyes", character.eyes),
    detail("Skin tone and texture", character.skin),
    detail("Height", character.height),
    detail("Body type and proportions", character.bodyType),
    listDetail("Exact default wardrobe", character.defaultClothing),
    listDetail("Accessories", character.accessories),
    detail(
      "Personality visible only through subtle expression",
      character.personality,
    ),
  ]);

  const prompt = [
    `Create one high-detail ${view.replaceAll("-", " ")} character reference image for a film production. Render it as a realistic production photograph unless the project visual style below explicitly requires another medium.`,
    `PROJECT: ${project.title}\nPROJECT VISUAL STYLE: ${projectStyle}\nPROJECT COUNTRY / CULTURE: ${projectCulture}`,
    `CHARACTER IDENTITY — treat every supplied detail as fixed:\n${identity.join("\n")}`,
    `COMPOSITION AND CAMERA — ${view.toUpperCase()} VIEW:\n- Exactly one person in one continuous image\n${compositionByView[view] ?? compositionByView.other}\n- 50mm full-frame lens look with natural perspective and no wide-angle distortion\n- Face remains sharp enough to identify eyes, skin texture, and facial structure\n- Vertical 4:5 composition with clean space around the subject`,
    "LIGHTING AND BACKGROUND:\n- Soft, even studio key and fill lighting with accurate skin color\n- Plain warm-gray seamless background, no location or environmental storytelling\n- Minimal soft contact shadow under the feet\n- High detail, realistic anatomy, natural fabric texture, restrained color grading",
    `CONTINUITY RULES:\n- Preserve the exact face, apparent age, body proportions, skin, hair, wardrobe, and accessories described above\n- This ${view.replaceAll("-", " ")} image will be reused as an identity reference for later shots\n- Do not redesign, beautify, age, de-age, or change ethnicity, body shape, hairstyle, clothing, or accessories\n- Do not add dramatic action or a cinematic pose unless the requested view is expression`,
    "DO NOT INCLUDE:\n- Additional people, duplicate views, split panels, contact sheets, mirrors, or reflections of the subject\n- Text, labels, captions, logos, signatures, borders, or watermarks\n- Scene props unless explicitly listed as an accessory\n- Cropped limbs, hidden hands, extra fingers, extra limbs, distorted anatomy, blurred face, heavy makeup, or extreme depth of field",
    missing.length > 0
      ? `UNSPECIFIED DETAILS: Choose natural, understated values for ${missing.join(", ")} and keep those choices internally consistent within this image. This generated image will become the final source of truth for those details.`
      : null,
    `OUTPUT: Return only the finished ${character.name} reference image, with no explanation or text outside the image.`,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");

  return characterReferencePromptSchema.parse({
    characterId: character.id,
    characterCode: character.code,
    view,
    filename: referenceFilename(character.name, view, "character"),
    prompt,
    ready: missing.length === 0,
    missingDetails: missing,
  });
}
