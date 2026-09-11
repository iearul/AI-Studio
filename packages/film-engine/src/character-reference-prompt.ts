import {
  characterReferencePromptSchema,
  type Character,
  type CharacterReferencePrompt,
  type Project,
} from "@ai-film-studio/contracts";

function detail(label: string, value: string | number | null): string | null {
  if (value === null || value === "") return null;
  return `- ${label}: ${value}`;
}

function listDetail(label: string, values: string[]): string | null {
  return values.length > 0 ? `- ${label}: ${values.join(", ")}` : null;
}

function compact(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function safeFilename(value: string): string {
  const stem = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${stem || "character"}-master-reference.png`;
}

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
    "Create one high-detail master character reference image for a film production. Render it as a realistic production photograph unless the project visual style below explicitly requires another medium.",
    `PROJECT: ${project.title}\nPROJECT VISUAL STYLE: ${projectStyle}\nPROJECT COUNTRY / CULTURE: ${projectCulture}`,
    `CHARACTER IDENTITY — treat every supplied detail as fixed:\n${identity.join("\n")}`,
    "COMPOSITION AND CAMERA:\n- Exactly one person, shown head-to-toe in one continuous image\n- Three-quarter front view at eye level, looking toward the camera\n- Neutral, relaxed standing pose; both hands visible and naturally separated from the torso\n- 50mm full-frame lens look with natural perspective and no wide-angle distortion\n- Camera far enough away that hair, shoes, hands, and clothing are not cropped\n- Face remains large and sharp enough to identify eyes, skin texture, and facial structure\n- Vertical 4:5 composition with generous clean space around the subject",
    "LIGHTING AND BACKGROUND:\n- Soft, even studio key and fill lighting with accurate skin color\n- Plain warm-gray seamless background, no location or environmental storytelling\n- Minimal soft contact shadow under the feet\n- High detail, realistic anatomy, natural fabric texture, restrained color grading",
    "CONTINUITY RULES:\n- Preserve the exact face, apparent age, body proportions, skin, hair, wardrobe, and accessories described above\n- The image will be reused as the identity reference for every later shot\n- Do not redesign, beautify, age, de-age, or change ethnicity, body shape, hairstyle, clothing, or accessories\n- Keep expression neutral and readable; no dramatic action or cinematic pose",
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
    filename: safeFilename(character.name),
    prompt,
    ready: missing.length === 0,
    missingDetails: missing,
  });
}
