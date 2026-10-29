import type {
  AuthorProfile,
  Book,
  ChapterCard,
  StoryBible,
  StoryConcept,
} from "@ai-studio/contracts";

import { manuscriptToPlainText } from "./markup.js";

/** Rough English estimate; providers report the real count after the call. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.8);
}

export type ContextSection = {
  title: string;
  body: string;
  /** Lower numbers are kept first when the budget is tight. */
  priority: number;
  /** Sections that may be shortened rather than dropped. */
  truncatable?: boolean;
};

/**
 * Assembles sections within a token budget, keeping high-priority sections
 * whole and shortening or dropping the rest. Output order follows input order.
 */
export function packContext(
  sections: ContextSection[],
  budgetTokens: number,
): { text: string; droppedTitles: string[]; tokens: number } {
  const ranked = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.body.trim().length > 0)
    .sort((a, b) => a.section.priority - b.section.priority);
  let remaining = budgetTokens;
  const kept = new Map<number, string>();
  const dropped: string[] = [];
  for (const { section, index } of ranked) {
    const block = `## ${section.title}\n${section.body.trim()}`;
    const cost = estimateTokens(block);
    if (cost <= remaining) {
      kept.set(index, block);
      remaining -= cost;
    } else if (section.truncatable && remaining > 200) {
      const allowedChars = Math.floor((remaining - 40) * 3.8);
      // Keep the end: for running text the most recent part matters most.
      const body = section.body.trim();
      const shortened = `## ${section.title} (shortened)\n…${body.slice(body.length - allowedChars)}`;
      kept.set(index, shortened);
      remaining -= estimateTokens(shortened);
    } else {
      dropped.push(section.title);
    }
  }
  const text = [...kept.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, block]) => block)
    .join("\n\n");
  return { text, droppedTitles: dropped, tokens: budgetTokens - remaining };
}

const bulletList = (items: readonly string[]) =>
  items.map((item) => `- ${item}`).join("\n");

export function describeBrief(
  book: Book,
  author: AuthorProfile | null,
): string {
  const brief = book.brief;
  const lines = [
    `Title: ${book.title}${book.subtitle ? ` — ${book.subtitle}` : ""}`,
    `Pen name: ${author?.penName ?? "unknown"}`,
    `Language: ${book.language}`,
    `Genre: ${brief.genre}${brief.subgenre ? ` / ${brief.subgenre}` : ""}`,
    brief.audience ? `Audience: ${brief.audience}` : "",
    `Target length: ${brief.targetWords.toLocaleString("en-US")} words in about ${brief.chapterCount} chapters`,
    `Point of view: ${brief.pointOfView}; tense: ${brief.tense}`,
    brief.tones.length ? `Tone: ${brief.tones.join(", ")}` : "",
    `Pacing: ${brief.pacing}; ending preference: ${brief.ending}`,
    `Intensity (0–5): suspense ${brief.suspense}, horror ${brief.horror}, romance ${brief.romance}, violence ${brief.violence}`,
    `Sensuality: ${brief.sensuality} (never sexually explicit)`,
    brief.isSeries
      ? `Series: ${book.seriesName ?? "planned series"} #${book.seriesNumber ?? 1} — leave room for continuation without an unresolved main plot`
      : "Standalone: resolve the main plot fully",
    brief.setting ? `Setting: ${brief.setting}` : "",
    brief.timePeriod ? `Time period: ${brief.timePeriod}` : "",
    brief.mainCharacter ? `Main character: ${brief.mainCharacter}` : "",
    brief.supportingCharacters
      ? `Supporting characters: ${brief.supportingCharacters}`
      : "",
    brief.centralConflict ? `Central conflict: ${brief.centralConflict}` : "",
    brief.mandatoryElements
      ? `Mandatory elements: ${brief.mandatoryElements}`
      : "",
    brief.forbidden
      ? `Forbidden themes, words, clichés or techniques: ${brief.forbidden}`
      : "",
    brief.specialInstructions
      ? `Special instructions: ${brief.specialInstructions}`
      : "",
    author?.contentPreferences
      ? `Author content preferences: ${author.contentPreferences}`
      : "",
    author?.defaultStyle ? `Author's house style: ${author.defaultStyle}` : "",
  ].filter(Boolean);
  const sections = [`Theme / idea:\n${brief.theme}`, lines.join("\n")];
  if (brief.customBrief) {
    sections.push(
      `Author's full brief (takes precedence where it conflicts):\n${brief.customBrief}`,
    );
  }
  if (brief.referenceMaterial) {
    sections.push(
      `Reference material supplied by the author (use for facts and inspiration; do not copy wording):\n${brief.referenceMaterial}`,
    );
  }
  return sections.join("\n\n");
}

export function describeConcept(concept: StoryConcept): string {
  return [
    `Working title: ${concept.workingTitle}`,
    `Logline: ${concept.logline}`,
    `Positioning: ${concept.genrePositioning}`,
    `Central conflict: ${concept.centralConflict}`,
    `Protagonist: ${concept.protagonist}`,
    `Emotional stakes: ${concept.emotionalStakes}`,
    `Core question: ${concept.coreQuestion}`,
    `Hook: ${concept.hook}`,
    `Ending direction: ${concept.potentialEnding}`,
  ].join("\n");
}

export function describeBibleCore(bible: StoryBible): string {
  return [
    `Premise: ${bible.premise}`,
    `Theme: ${bible.theme}`,
    bible.settingRules.length
      ? `Setting rules:\n${bulletList(bible.settingRules)}`
      : "",
    `Viewpoint rules: ${bible.viewpointRules}`,
    `Narrative voice: ${bible.styleGuide.narrativeVoice}`,
    bible.styleGuide.proseRules.length
      ? `Prose rules:\n${bulletList(bible.styleGuide.proseRules)}`
      : "",
    bible.styleGuide.dialogueRules.length
      ? `Dialogue rules:\n${bulletList(bible.styleGuide.dialogueRules)}`
      : "",
    bible.styleGuide.avoid.length
      ? `Avoid:\n${bulletList(bible.styleGuide.avoid)}`
      : "",
    bible.plotConstraints.length
      ? `Plot constraints:\n${bulletList(bible.plotConstraints)}`
      : "",
    `Ending resolution (author's eyes only; never reveal early): ${bible.endingResolution}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function describeCharacters(
  bible: StoryBible,
  names?: string[],
): string {
  const wanted = names?.map((name) => name.toLowerCase());
  const characters = wanted
    ? bible.characters.filter((character) =>
        wanted.some(
          (name) =>
            name.includes(character.name.toLowerCase()) ||
            character.name.toLowerCase().includes(name),
        ),
      )
    : bible.characters;
  return characters
    .map((character) =>
      [
        `### ${character.name} (${character.role}${character.age ? `, ${character.age}` : ""})`,
        character.description,
        character.physicalDetails
          ? `Physical: ${character.physicalDetails}`
          : "",
        `Wants: ${character.goal}. Motivation: ${character.motivation}. Fears: ${character.fear}.`,
        character.secret ? `Secret: ${character.secret}` : "",
        `Arc: ${character.arc}`,
        `Speech: ${character.speechPattern}`,
        character.relationships.length
          ? `Relationships: ${character.relationships.map((item) => `${item.with} — ${item.relation}`).join("; ")}`
          : "",
        character.state ? `Current state: ${character.state}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export function describeArchitecture(bible: StoryBible): string {
  const architecture = bible.architecture;
  if (!architecture) return "";
  return [
    `Structure: ${architecture.structure} — ${architecture.structureRationale}`,
    architecture.acts
      .map((act) => `${act.name}: ${act.summary} (turn: ${act.turningPoint})`)
      .join("\n"),
    `Beginning: ${architecture.beginning}`,
    `Middle: ${architecture.middle}`,
    `Ending: ${architecture.ending}`,
    architecture.truthTimeline.length
      ? `Hidden truth timeline:\n${bulletList(architecture.truthTimeline.map((event) => `${event.when}: ${event.event}`))}`
      : "",
    architecture.suspects.length
      ? `Suspects:\n${bulletList(architecture.suspects.map((suspect) => `${suspect.name} — motive: ${suspect.motive}; opportunity: ${suspect.opportunity}${suspect.isCulprit ? " (culprit)" : ""}`))}`
      : "",
    architecture.redHerrings.length
      ? `Red herrings:\n${bulletList(architecture.redHerrings)}`
      : "",
    architecture.revealOrder.length
      ? `Reveal order:\n${bulletList(architecture.revealOrder)}`
      : "",
    architecture.threatRules.length
      ? `Threat rules:\n${bulletList(architecture.threatRules)}`
      : "",
    architecture.relationshipArc.length
      ? `Relationship arc:\n${bulletList(architecture.relationshipArc)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function describeClues(bible: StoryBible, uptoChapter?: number): string {
  return bible.clues
    .filter(
      (clue) =>
        uptoChapter === undefined ||
        clue.status !== "paid-off" ||
        (clue.payoffChapter ?? 0) >= uptoChapter - 1,
    )
    .map(
      (clue) =>
        `- [${clue.kind}, ${clue.status}] ${clue.description} → payoff: ${clue.payoff}` +
        `${clue.plantChapter ? ` (plant ch. ${clue.plantChapter})` : ""}` +
        `${clue.payoffChapter ? ` (pay off ch. ${clue.payoffChapter})` : ""}` +
        `${clue.notes ? ` — ${clue.notes}` : ""}`,
    )
    .join("\n");
}

export function describeCanon(bible: StoryBible, limit = 120): string {
  return bible.canonFacts
    .slice(-limit)
    .map(
      (fact) =>
        `- ${fact.fact}${fact.chapterNumber ? ` (ch. ${fact.chapterNumber})` : ""}`,
    )
    .join("\n");
}

export function describeChronology(bible: StoryBible): string {
  return bible.chronology
    .map(
      (event) =>
        `- ${event.when}: ${event.event}${event.chapterNumber ? ` (ch. ${event.chapterNumber})` : ""}${event.hiddenFromReader ? " [hidden from reader]" : ""}`,
    )
    .join("\n");
}

export function describeCard(number: number, card: ChapterCard): string {
  return [
    `Chapter ${number}${card.title ? `: ${card.title}` : ""}`,
    `Viewpoint: ${card.povCharacter}. Location: ${card.location}. Time: ${card.time}.`,
    `Objective: ${card.objective}`,
    `Opening hook: ${card.openingHook}`,
    `Scenes:\n${card.scenes.map((scene, index) => `${index + 1}. ${scene.summary} (purpose: ${scene.purpose})`).join("\n")}`,
    `Conflict and escalation: ${card.conflict}`,
    card.newInformation.length
      ? `New information:\n${bulletList(card.newInformation)}`
      : "",
    card.clues.length ? `Clues:\n${bulletList(card.clues)}` : "",
    card.continuityReferences.length
      ? `Continuity references:\n${bulletList(card.continuityReferences)}`
      : "",
    `Emotional movement: ${card.emotionalMovement}`,
    `Ending beat: ${card.endingBeat}`,
    `Target length: about ${card.targetWords.toLocaleString("en-US")} words`,
    card.dependsOn.length
      ? `Depends on chapters: ${card.dependsOn.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function describeOutline(
  chapters: Array<{ number: number; card: ChapterCard }>,
): string {
  return chapters
    .map(
      ({ number, card }) =>
        `${number}. ${card.title ?? "Untitled"} — ${card.povCharacter}; ${card.objective} → ${card.endingBeat}`,
    )
    .join("\n");
}

/** The final words of a chapter, cut at a paragraph boundary. */
export function chapterTail(markup: string, maxWords: number): string {
  const paragraphs = manuscriptToPlainText(markup).split("\n\n");
  const kept: string[] = [];
  let words = 0;
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index]!;
    const count = paragraph.split(/\s+/).length;
    if (words + count > maxWords && kept.length > 0) break;
    kept.unshift(paragraph);
    words += count;
  }
  return kept.join("\n\n");
}
