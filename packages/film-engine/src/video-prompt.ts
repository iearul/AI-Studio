import type { Project, Shot } from "@ai-studio/contracts";

export function buildVideoPrompt(project: Project, shot: Shot): string {
  return [
    `Animate the supplied approved storyboard image into one continuous ${shot.durationSeconds}-second cinematic shot.`,
    `ACTION: ${shot.action}`,
    `CAMERA: ${shot.shotType}, ${shot.cameraAngle}, ${shot.lens}, ${shot.cameraMovement}.`,
    `LIGHTING: ${shot.lighting}.`,
    `EMOTIONAL INTENT: ${shot.emotion}.`,
    project.visualStyle
      ? `PROJECT VISUAL STYLE: ${project.visualStyle}.`
      : undefined,
    `FRAME: Preserve the source image's ${project.aspectRatio} composition for the whole clip.`,
    "CONTINUITY RULES: Treat the supplied image as the exact identity and design reference. Preserve every visible face, apparent age, body proportion, wardrobe item, prop, material, color, location feature, lighting direction, and spatial relationship. Begin exactly from that frame. Use natural temporal motion and physically coherent anatomy, hands, fabric, hair, shadows, reflections, and object contact. Keep identity and geometry stable from first frame to last.",
    "EDITING RULES: One shot only. No cuts, transitions, new subjects, disappearing objects, scene changes, zoom jumps, morphing, time lapses, duplicated limbs, flicker, captions, subtitles, logos, borders, signatures, or watermarks. Do not invent dialogue or on-screen text.",
    "OUTPUT: Return only the finished video clip.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");
}
