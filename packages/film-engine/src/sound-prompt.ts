import type {
  Character,
  DialogueLine,
  Project,
  Scene,
  Shot,
  StoryPlan,
} from "@ai-studio/contracts";

const speakerPattern = /^\s*([^:]{1,80}?)\s*:\s*(.+)$/;

function key(value: string): string {
  return value.trim().toLowerCase();
}

function unquote(value: string): string {
  return value
    .trim()
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .trim();
}

/** ElevenLabs language code for the project, or null to let it detect. */
export function speechLanguageCode(project: Project): string | null {
  return project.language === "other" ? null : project.language;
}

/**
 * Splits scene dialogue into speaker turns. A "Name: line" prefix names the
 * speaker by Bible name or code; an unlabelled line belongs to the scene's
 * first character. Speakers that match no Bible character keep a null id.
 */
export function parseDialogue(
  scene: Pick<Scene, "dialogue" | "characters">,
  characters: Character[],
): DialogueLine[] {
  if (!scene.dialogue?.trim()) return [];
  const byName = new Map<string, Character>();
  for (const character of characters) {
    byName.set(key(character.name), character);
    byName.set(key(character.code), character);
  }
  const fallbackName = scene.characters[0];
  const fallback = fallbackName ? byName.get(key(fallbackName)) : undefined;
  return scene.dialogue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = speakerPattern.exec(line);
      const labelled = match ? byName.get(key(match[1]!)) : undefined;
      if (match && (labelled || !fallback)) {
        return {
          speaker: labelled?.name ?? match[1]!.trim(),
          characterId: labelled?.id ?? null,
          text: unquote(match[2]!),
        };
      }
      return {
        speaker: fallback?.name ?? fallbackName ?? "Unknown speaker",
        characterId: fallback?.id ?? null,
        text: unquote(line),
      };
    })
    .filter((line) => line.text.length > 0);
}

export function soundEffectDuration(shot: Pick<Shot, "durationSeconds">) {
  return Math.min(30, Math.max(0.5, shot.durationSeconds));
}

export function buildSoundEffectPrompt(
  scene: Pick<Scene, "timeOfDay">,
  shot: Pick<Shot, "action" | "location" | "emotion">,
): string {
  const action =
    shot.action.length > 240 ? `${shot.action.slice(0, 237)}...` : shot.action;
  return [
    `Realistic film sound effects and ambience for one shot: ${action}`,
    `Setting: ${shot.location}, ${scene.timeOfDay}.`,
    `Mood: ${shot.emotion}.`,
    "Only natural sounds of the action and place. No music, no speech, no voices.",
  ].join(" ");
}

export function musicDuration(project: Project, plan: StoryPlan | undefined) {
  const shots = plan?.scenes.flatMap((scene) => scene.shots) ?? [];
  const total = shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  return Math.min(
    600,
    Math.max(10, Math.round(total || project.targetDurationSeconds)),
  );
}

export function buildMusicPrompt(
  project: Project,
  plan: StoryPlan | undefined,
): string {
  const story = plan?.story;
  const style = project.visualStyle || project.customStyle || project.style;
  return [
    `Instrumental background score for a ${musicDuration(project, plan)}-second ${story?.genre ?? project.style} ${project.type === "reel" ? "short vertical reel" : "video"}${story ? ` titled "${story.title}"` : ""}.`,
    `Tone: ${story?.tone ?? project.tone ?? project.style}.`,
    story
      ? `Emotional arc: opens with ${story.beginning.slice(0, 120)}; builds to ${story.climax.slice(0, 120)}; leaves the audience feeling ${story.audienceEmotion}.`
      : null,
    `Visual style: ${style}.`,
    project.countryCulture
      ? `Draw lightly on the musical color of ${project.countryCulture}.`
      : null,
    "Steady and unobtrusive so narration stays clear. No vocals, no lyrics.",
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}
