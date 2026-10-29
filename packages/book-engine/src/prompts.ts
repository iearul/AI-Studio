import type {
  AuthorProfile,
  Book,
  ChapterCard,
  EditorialKind,
  PassageOperation,
  StoryBible,
  StoryConcept,
} from "@ai-film-studio/contracts";

import {
  chapterTail,
  describeArchitecture,
  describeBibleCore,
  describeBrief,
  describeCanon,
  describeCard,
  describeCharacters,
  describeChronology,
  describeClues,
  describeConcept,
  describeOutline,
  packContext,
  type ContextSection,
} from "./context.js";
import { proseGuidelines, resolveCraftProfile } from "./craft.js";
import { kdpRules } from "./kdp-rules.js";

export type PromptSpec = {
  system: string;
  /** Stable context shared by many calls; providers may cache it. */
  cachedContext?: string;
  prompt: string;
};

export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const markupRules = `Output format for prose:
- Plain text paragraphs separated by one blank line. No chapter heading, title, notes or commentary.
- Italics as *word*, bold only if the story truly needs it as **word**.
- A scene break is a line containing only: * * *
- Use typographic quotes and apostrophes consistent with the book's language.`;

function contentRules(book: Book): string {
  const brief = book.brief;
  return [
    "Content boundaries for this book:",
    `- Sensuality: ${brief.sensuality}. Intimate scenes are never sexually explicit; ${
      brief.sensuality === "none"
        ? "no sexual content"
        : brief.sensuality === "fade-to-black"
          ? "cut away before intimacy becomes physical"
          : brief.sensuality === "suggestive"
            ? "tension and implication only, closing the door before explicit detail"
            : "kisses and affection at most"
    }.`,
    `- Violence ${brief.violence}/5 and horror ${brief.horror}/5: match that intensity; never gratuitous.`,
    "- No real living people portrayed defamatorily, no existing trademarked characters or fictional universes, no copied text.",
    brief.forbidden ? `- Forbidden by the author: ${brief.forbidden}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function systemPrompt(book: Book, role: string): string {
  const craft = resolveCraftProfile(
    book.brief.craftProfile,
    book.brief.genre,
    book.brief.subgenre,
  );
  return [
    `You are ${role} working with an independent author on an original ${book.brief.genre} book written in ${languageName(book.language)}.`,
    "The work must be original. Learn from genre-level craft, never imitate the distinctive prose of any living author and never reproduce protected text, characters or settings.",
    `Craft profile — ${craft.label}:\n${craft.techniques.map((item) => `- ${item}`).join("\n")}`,
    `Prose principles:\n${proseGuidelines.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    contentRules(book),
    "Quality comes from specificity, causality and deliberate choices, not from inserted imperfections.",
  ].join("\n\n");
}

// --- Stage A ---------------------------------------------------------------

export function conceptsPrompt(
  book: Book,
  author: AuthorProfile | null,
  options: { count: number; avoid: StoryConcept[]; guidance?: string },
): PromptSpec {
  return {
    system: systemPrompt(book, "a development editor and story architect"),
    prompt: [
      `Develop ${options.count} distinct, original story concepts from this brief.`,
      describeBrief(book, author),
      options.avoid.length
        ? `The author has already seen these concepts; make the new ones clearly different:\n${options.avoid.map((concept) => `- ${concept.workingTitle}: ${concept.logline}`).join("\n")}`
        : "",
      options.guidance
        ? `Author guidance for this round: ${options.guidance}`
        : "",
      [
        "For each concept:",
        "- a working title that is not the title of a well-known existing book or film,",
        "- a logline with a specific protagonist, goal, obstacle and stakes,",
        "- genre positioning: what shelf it sits on and which reader promises it makes,",
        "- the central conflict, protagonist, emotional stakes and the core mystery or story question,",
        "- the narrative hook of the opening chapters and a potential ending that fits the requested ending preference,",
        "- originality risks: honestly name familiar tropes or well-known works it could be compared to, and how this concept differs.",
        `Write every field in ${languageName(book.language)}.`,
      ].join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

// --- Stage B ---------------------------------------------------------------

export function biblePrompt(
  book: Book,
  author: AuthorProfile | null,
  concept: StoryConcept,
  guidance?: string,
): PromptSpec {
  return {
    system: systemPrompt(book, "a story architect building the story bible"),
    prompt: [
      "Build the authoritative story bible for this book. Every later chapter is written from it, so be concrete and internally consistent.",
      describeBrief(book, author),
      `Chosen concept:\n${describeConcept(concept)}`,
      guidance ? `Author guidance: ${guidance}` : "",
      [
        "Requirements:",
        "- Characters: give each a specific name suited to the setting, a role, motivation, fear, goal, secret where relevant, an arc and a distinct speech pattern. Relationships name the other character.",
        "- Setting rules: what is and is not possible in this world, institutions, geography, technology, period details.",
        "- Chronology: dated or sequenced events, including back-story; mark events the reader must not learn until later as hidden.",
        "- Clues and payoffs register: every clue, red herring, foreshadowing and setup with its planned payoff and approximate chapters.",
        `- Viewpoint rules for ${book.brief.pointOfView} in ${book.brief.tense} tense.`,
        "- A style guide with a narrative voice described in your own terms, prose rules, dialogue rules and a list of things to avoid.",
        "- Plot constraints, the ending resolution, and open questions the author still has to decide.",
        `Write in ${languageName(book.language)}.`,
      ].join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

// --- Stage C ---------------------------------------------------------------

export function architecturePrompt(
  book: Book,
  author: AuthorProfile | null,
  bible: StoryBible,
  guidance?: string,
): PromptSpec {
  const genre = `${book.brief.genre} ${book.brief.subgenre ?? ""}`;
  const genreNeeds = [
    /myster|thrill|crime|detective|suspense/i.test(genre)
      ? "This is a mystery/thriller: give the hidden truth timeline in real order, every suspect's motive and opportunity, red herrings with innocent explanations, and the order of reveals. Fair play: the solution must be inferable from planted clues."
      : "",
    /horror|gothic|supernatural|haunt/i.test(genre) || book.brief.horror >= 2
      ? "There is a horror element: state the rules of the threat, or the precise uncertainty that replaces rules, and how it escalates."
      : "",
    /romanc/i.test(genre) || book.brief.romance >= 2
      ? "There is a romance line: track relationship progression step by step beside the external conflict."
      : "",
  ].filter(Boolean);
  return {
    system: systemPrompt(book, "a story architect designing the plot"),
    prompt: [
      "Design the plot architecture before any chapter is drafted: a coherent beginning, middle and ending that deliver on the concept.",
      describeBrief(book, author),
      `Story bible:\n${describeBibleCore(bible)}\n\nCharacters:\n${describeCharacters(bible)}\n\nChronology:\n${describeChronology(bible)}\n\nClues:\n${describeClues(bible)}`,
      `Choose the structure that suits this book (three-act, four-act, seven-point, Kishōtenketsu, dual timeline, or another) and explain why. Pacing is ${book.brief.pacing}.`,
      ...genreNeeds,
      "Leave empty lists for sections that do not apply.",
      guidance ? `Author guidance: ${guidance}` : "",
      `Write in ${languageName(book.language)}.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

// --- Stage D ---------------------------------------------------------------

export function outlinePrompt(
  book: Book,
  author: AuthorProfile | null,
  bible: StoryBible,
  targets: number[],
  guidance?: string,
): PromptSpec {
  return {
    system: systemPrompt(book, "a story architect writing the chapter outline"),
    prompt: [
      `Write exactly ${targets.length} chapter cards that together tell the complete story.`,
      describeBrief(book, author),
      `Story bible:\n${describeBibleCore(bible)}\n\nCharacters:\n${describeCharacters(bible)}`,
      `Plot architecture:\n${describeArchitecture(bible)}`,
      `Clues and payoffs:\n${describeClues(bible)}`,
      `Planned chapter lengths (words): ${targets.map((words, index) => `${index + 1}: ${words}`).join(", ")}. Give longer chapters more scenes.`,
      [
        "Each card names the viewpoint character, place and time, the chapter's objective, its opening hook, 1–6 scenes with purpose, conflict and escalation, new information, clues planted or paid off, continuity references to earlier chapters, the emotional movement, the ending beat, and the earlier chapters it depends on.",
        "Vary chapter shapes: not every chapter opens the same way or ends on a cliffhanger.",
        "Plant every clue before its payoff; pay off every setup by the end.",
        `Write in ${languageName(book.language)}. Chapter titles are optional; use null when a title would not help.`,
      ].join("\n"),
      guidance ? `Author guidance: ${guidance}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function chapterCardPrompt(
  book: Book,
  author: AuthorProfile | null,
  bible: StoryBible,
  chapters: Array<{ number: number; card: ChapterCard }>,
  chapterNumber: number,
  targetWords: number,
  guidance?: string,
): PromptSpec {
  return {
    system: systemPrompt(
      book,
      "a story architect revising the chapter outline",
    ),
    prompt: [
      describeBrief(book, author),
      `Story bible:\n${describeBibleCore(bible)}\n\nCharacters:\n${describeCharacters(bible)}`,
      `Plot architecture:\n${describeArchitecture(bible)}`,
      `Current outline:\n${describeOutline(chapters)}`,
      [
        `Rewrite only the card for chapter ${chapterNumber} (about ${targetWords.toLocaleString("en-US")} words) so it fits between its neighbours and keeps every setup and payoff the outline relies on.`,
        guidance ? `Author guidance: ${guidance}` : "",
        `Write in ${languageName(book.language)}. Return exactly one card in the chapters list.`,
      ]
        .filter(Boolean)
        .join("\n"),
    ].join("\n\n"),
  };
}

// --- Stage E ---------------------------------------------------------------

export type DraftContextInput = {
  book: Book;
  author: AuthorProfile | null;
  bible: StoryBible;
  chapters: Array<{
    number: number;
    card: ChapterCard;
    summary: string | null;
    content: string;
  }>;
  chapterNumber: number;
};

/** Stable part of every drafting call: identical across chapters, so cacheable. */
export function draftingCachedContext(input: DraftContextInput): string {
  const { book, author, bible, chapters } = input;
  return packContext(
    [
      { title: "Brief", body: describeBrief(book, author), priority: 1 },
      { title: "Story bible", body: describeBibleCore(bible), priority: 1 },
      { title: "Characters", body: describeCharacters(bible), priority: 2 },
      {
        title: "Plot architecture",
        body: describeArchitecture(bible),
        priority: 3,
      },
      {
        title: "Full outline",
        body: describeOutline(
          chapters.map(({ number, card }) => ({ number, card })),
        ),
        priority: 2,
      },
    ],
    40_000,
  ).text;
}

/** Per-chapter context: previous summaries, the last pages, open threads. */
export function chapterContext(input: DraftContextInput): string {
  const { bible, chapters, chapterNumber } = input;
  const current = chapters.find((chapter) => chapter.number === chapterNumber);
  const previous = chapters.filter((chapter) => chapter.number < chapterNumber);
  const before = previous[previous.length - 1];
  const next = chapters.find((chapter) => chapter.number === chapterNumber + 1);
  const dependencies = (current?.card.dependsOn ?? [])
    .map((number) => chapters.find((chapter) => chapter.number === number))
    .filter((chapter) => chapter && chapter.number < chapterNumber - 1);
  const sections: ContextSection[] = [
    {
      title: "What happened so far (chapter summaries)",
      body: previous
        .map(
          (chapter) =>
            `${chapter.number}. ${chapter.summary ?? "(no summary yet) " + chapter.card.objective}`,
        )
        .join("\n"),
      priority: 1,
      truncatable: true,
    },
    {
      title: `End of chapter ${before?.number ?? ""} (continue seamlessly from here)`,
      body: before?.content ? chapterTail(before.content, 900) : "",
      priority: 2,
      truncatable: true,
    },
    {
      title: "Earlier chapters this one depends on",
      body: dependencies
        .map(
          (chapter) =>
            `Chapter ${chapter!.number}: ${chapter!.summary ?? ""}\n${chapterTail(chapter!.content, 250)}`,
        )
        .join("\n\n"),
      priority: 4,
      truncatable: true,
    },
    {
      title: "Established facts (canon — do not contradict)",
      body: describeCanon(bible),
      priority: 2,
      truncatable: true,
    },
    {
      title: "Chronology so far",
      body: describeChronology(bible),
      priority: 3,
      truncatable: true,
    },
    {
      title: "Open clues, mysteries and payoffs",
      body: describeClues(bible, chapterNumber),
      priority: 3,
      truncatable: true,
    },
    {
      title: "Characters in this chapter (current state)",
      body: current
        ? describeCharacters(bible, [
            current.card.povCharacter,
            ...current.card.scenes.flatMap((scene) =>
              bible.characters
                .filter((character) => scene.summary.includes(character.name))
                .map((character) => character.name),
            ),
          ])
        : "",
      priority: 2,
    },
    {
      title: "Next chapter (for transitions only; do not write it)",
      body: next
        ? describeCard(next.number, next.card)
        : "This is the final chapter.",
      priority: 5,
    },
  ];
  return packContext(sections, 30_000).text;
}

export function chapterDraftPrompt(input: DraftContextInput): PromptSpec {
  const current = input.chapters.find(
    (chapter) => chapter.number === input.chapterNumber,
  )!;
  return {
    system: systemPrompt(input.book, "the novelist drafting this book"),
    cachedContext: draftingCachedContext(input),
    prompt: [
      chapterContext(input),
      `## Chapter to write now\n${describeCard(current.number, current.card)}`,
      [
        `Write chapter ${current.number} in full, about ${current.card.targetWords.toLocaleString("en-US")} words, in ${languageName(input.book.language)}, ${input.book.brief.pointOfView} point of view, ${input.book.brief.tense} tense.`,
        "Cover every scene on the card in order, dramatized rather than summarized. Honour the canon and chronology exactly.",
        "If the card conflicts with canon, follow canon and keep the card's purpose.",
        markupRules,
      ].join("\n"),
    ].join("\n\n"),
  };
}

export function sceneDraftPrompt(
  input: DraftContextInput,
  sceneIndex: number,
  sceneWords: number,
  previousScenes: string[],
): PromptSpec {
  const current = input.chapters.find(
    (chapter) => chapter.number === input.chapterNumber,
  )!;
  const scene = current.card.scenes[sceneIndex]!;
  return {
    system: systemPrompt(input.book, "the novelist drafting this book"),
    cachedContext: draftingCachedContext(input),
    prompt: [
      chapterContext(input),
      `## Chapter card\n${describeCard(current.number, current.card)}`,
      previousScenes.length
        ? `## This chapter so far\n${previousScenes.join("\n\n* * *\n\n")}`
        : "",
      [
        `Write only scene ${sceneIndex + 1} of ${current.card.scenes.length}: ${scene.summary} (purpose: ${scene.purpose}).`,
        `About ${sceneWords.toLocaleString("en-US")} words. Continue directly from the chapter so far; do not repeat it and do not write later scenes.`,
        sceneIndex === 0
          ? `Open with the chapter's hook: ${current.card.openingHook}`
          : "",
        sceneIndex === current.card.scenes.length - 1
          ? `End on the chapter's ending beat: ${current.card.endingBeat}`
          : "",
        markupRules,
      ]
        .filter(Boolean)
        .join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function coherencePrompt(
  input: DraftContextInput,
  scenes: string[],
): PromptSpec {
  const current = input.chapters.find(
    (chapter) => chapter.number === input.chapterNumber,
  )!;
  return {
    system: systemPrompt(input.book, "the novelist revising this chapter"),
    cachedContext: draftingCachedContext(input),
    prompt: [
      `## Chapter card\n${describeCard(current.number, current.card)}`,
      `## Scene drafts\n${scenes.join("\n\n* * *\n\n")}`,
      [
        "Join these scene drafts into one finished chapter.",
        "Smooth transitions, remove repetition between scenes, keep every event, keep scene breaks only where time or place jumps, and keep the length about the same.",
        "Do not add a summary of what happened. Return the whole chapter.",
        markupRules,
      ].join("\n"),
    ].join("\n\n"),
  };
}

export function expansionPrompt(
  input: DraftContextInput,
  draft: string,
  actualWords: number,
): PromptSpec {
  const current = input.chapters.find(
    (chapter) => chapter.number === input.chapterNumber,
  )!;
  return {
    system: systemPrompt(input.book, "the novelist revising this chapter"),
    cachedContext: draftingCachedContext(input),
    prompt: [
      `## Chapter card\n${describeCard(current.number, current.card)}`,
      `## Current draft (${actualWords} words)\n${draft}`,
      [
        `The draft is short of the planned ${current.card.targetWords.toLocaleString("en-US")} words.`,
        "Expand it by deepening what matters: dramatize summarized moments, sharpen conflict inside scenes, let characters make and pay for decisions, add specific grounding detail.",
        "Never pad with repetition, recap or decorative description. Keep all existing events and the ending beat. Return the whole revised chapter.",
        markupRules,
      ].join("\n"),
    ].join("\n\n"),
  };
}

// --- Stage F ---------------------------------------------------------------

export function inspectionPrompt(
  input: DraftContextInput,
  chapterText: string,
): PromptSpec {
  const current = input.chapters.find(
    (chapter) => chapter.number === input.chapterNumber,
  )!;
  const previous = input.chapters.filter(
    (chapter) => chapter.number < input.chapterNumber,
  );
  return {
    system: [
      `You are a meticulous continuity editor for a ${input.book.brief.genre} book. You report facts with evidence and never invent problems.`,
      "Quote the chapter text exactly as evidence. When there is nothing to report in a list, return an empty list.",
    ].join("\n"),
    prompt: [
      packContext(
        [
          {
            title: "Characters",
            body: describeCharacters(input.bible),
            priority: 1,
          },
          {
            title: "Canon facts",
            body: describeCanon(input.bible, 300),
            priority: 1,
            truncatable: true,
          },
          {
            title: "Chronology",
            body: describeChronology(input.bible),
            priority: 2,
            truncatable: true,
          },
          { title: "Clues", body: describeClues(input.bible), priority: 2 },
          {
            title: "Earlier chapter summaries",
            body: previous
              .map((chapter) => `${chapter.number}. ${chapter.summary ?? ""}`)
              .join("\n"),
            priority: 1,
            truncatable: true,
          },
          {
            title: "End of the previous chapter",
            body: previous.length
              ? chapterTail(previous[previous.length - 1]!.content, 300)
              : "",
            priority: 3,
          },
        ],
        40_000,
      ).text,
      `## Chapter card\n${describeCard(current.number, current.card)}`,
      `## Chapter ${current.number} text\n${chapterText}`,
      [
        "Inspect this chapter against the established story:",
        "- summary: 120–250 words of what happens, including who learns what;",
        "- chronology: events with their time;",
        "- newFacts: facts this chapter establishes (names, ages, places, physical details, relationships, objects, rules);",
        "- characterStates: how each character present has changed (location, injuries, knowledge, emotional state, relationships);",
        "- clueUpdates: clues planted, advanced or paid off;",
        "- contradictions: conflicts with canon, chronology, ages, physical details, earlier events or viewpoint rules, with exact evidence;",
        "- repetitions: accidental repetition of phrases, beats or information the reader already has;",
        "- transitionNote: whether the opening follows logically from the previous chapter (null if fine);",
        "- canonChanges: anything this chapter changes about established canon, with the reason.",
      ].join("\n"),
    ].join("\n\n"),
  };
}

// --- Editorial ---------------------------------------------------------------

const editorialRoles: Record<
  Exclude<EditorialKind, "style" | "inspection">,
  string
> = {
  developmental:
    "a developmental editor. Assess plot structure, pacing, stakes, character arcs, narrative tension, setups and payoffs, and whether the ending keeps the story's promises. Report problems that matter to readers, with chapter-level evidence. Leave originalText and replacementText null.",
  continuity:
    "a continuity editor. Check dates, ages, locations, relationships, physical details, clues, chronology and established facts across chapters. Report only real inconsistencies with exact quotes; when a local fix exists, give the exact originalText from the chapter and the replacementText.",
  line: "a line editor. Improve clarity, precision, rhythm, dialogue and scene flow while preserving the narrative voice. Report specific passages: originalText must be copied exactly from the chapter (one to three sentences) and replacementText is your improved version. Do not rewrite whole chapters.",
  copy: "a copy editor. Check spelling, grammar, punctuation, capitalization, consistency of names and style. Every finding must give the exact originalText and the corrected replacementText.",
  originality:
    "an originality and rights reviewer. Flag suspicious similarity to well-known works, recognizable protected characters, universes or trademarks, real people portrayed in a defamatory or private way, potentially infringing titles or cover concepts, quoted song lyrics or poems, and unsupported factual claims. Do not claim plagiarism clearance or give an originality score; state what you checked and what a human should verify.",
};

export function editorialPrompt(
  book: Book,
  kind: Exclude<EditorialKind, "style" | "inspection">,
  bible: StoryBible,
  material: string,
  scope: string,
): PromptSpec {
  return {
    system: [
      `You are ${editorialRoles[kind]}`,
      `The book is an original ${book.brief.genre} in ${languageName(book.language)}. Write findings in ${languageName(book.language)}, except the severity values.`,
      "Severity: critical breaks the story or a rule; major clearly hurts the reading experience; minor is a local flaw; suggestion is optional polish.",
      "Location names the chapter and the scene or paragraph. Evidence quotes the text. Never invent text that is not in the manuscript.",
    ].join("\n\n"),
    prompt: [
      packContext(
        [
          { title: "Story bible", body: describeBibleCore(bible), priority: 1 },
          {
            title: "Characters",
            body: describeCharacters(bible),
            priority: 1,
            truncatable: true,
          },
          {
            title: "Canon facts",
            body: describeCanon(bible, 400),
            priority: 2,
            truncatable: true,
          },
          {
            title: "Plot architecture",
            body: describeArchitecture(bible),
            priority: 2,
            truncatable: true,
          },
        ],
        30_000,
      ).text,
      `## Manuscript under review (${scope})\n${material}`,
      "Return a short summary, the manuscript's real strengths, and the findings ordered by severity.",
    ].join("\n\n"),
  };
}

// --- Passage operations ------------------------------------------------------

const passageInstructions: Record<PassageOperation, string> = {
  rewrite:
    "Rewrite the passage to be sharper and more specific while keeping its events, meaning and voice.",
  expand:
    "Expand the passage into a fuller scene moment: dramatize, deepen conflict and characterization, add precise grounding detail. Do not pad.",
  "improve-dialogue":
    "Improve the dialogue: distinct voices, subtext, fewer tags and adverbs, every line doing work. Keep the events.",
  "adjust-pacing":
    "Adjust the pacing: tighten slack sentences, cut recap, and let key beats land with the right weight.",
  "fix-grammar":
    "Correct spelling, grammar and punctuation only. Change nothing else.",
};

export function passagePrompt(
  book: Book,
  bible: StoryBible | null,
  operation: PassageOperation,
  passage: string,
  surrounding: string,
  instruction?: string | null,
): PromptSpec {
  return {
    system: systemPrompt(book, "the novelist revising a passage"),
    prompt: [
      bible ? `## Style\n${bible.styleGuide.narrativeVoice}` : "",
      surrounding ? `## Surrounding text (context only)\n${surrounding}` : "",
      `## Passage\n${passage}`,
      [
        passageInstructions[operation],
        instruction ? `Author's instruction: ${instruction}` : "",
        "Return only the replacement passage.",
        markupRules,
      ]
        .filter(Boolean)
        .join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

// --- Listing and cover -------------------------------------------------------

export function metadataPrompt(
  book: Book,
  author: AuthorProfile | null,
  bible: StoryBible | null,
  summaries: string[],
  wordCount: number,
): PromptSpec {
  const rules = kdpRules.metadata;
  return {
    system: [
      "You prepare honest Amazon KDP eBook listings for an independent author.",
      "Never invent reviews, awards, bestseller status, endorsements, credentials, or comparisons that imply an affiliation with another author or book.",
      "The listing must describe the actual book.",
    ].join("\n"),
    prompt: [
      `Book: ${book.title}${book.subtitle ? ` — ${book.subtitle}` : ""} by ${author?.penName ?? "the author"}, ${wordCount.toLocaleString("en-US")} words, ${languageName(book.language)}, ${book.brief.genre}${book.brief.subgenre ? ` / ${book.brief.subgenre}` : ""}.`,
      book.seriesName
        ? `Series: ${book.seriesName} #${book.seriesNumber ?? 1}.`
        : "Standalone.",
      bible
        ? `Premise: ${bible.premise}\nTheme: ${bible.theme}\nMain characters: ${bible.characters
            .slice(0, 5)
            .map((character) => `${character.name} (${character.role})`)
            .join(", ")}`
        : "",
      `Chapter summaries (spoilers for your understanding only):\n${summaries.map((summary, index) => `${index + 1}. ${summary}`).join("\n")}`,
      [
        `Description: a sales blurb in ${languageName(book.language)} without spoilers past the first act, at most ${rules.descriptionMaxChars} characters including HTML. Only these tags: ${rules.descriptionAllowedTags.join(", ")}. No URLs, prices, emoji, quotes from reviews or time-sensitive claims.`,
        `Keywords: exactly ${rules.keywordsMax} search phrases readers would type — themes, setting, character types, tropes, mood. Do not repeat the title, do not use other authors' names, and never use words like free, bestseller, Kindle, KDP or new.`,
        `Categories: ${rules.categoriesMax} Amazon Kindle Store browse-category paths that truly fit (for example "Kindle Store › Kindle eBooks › Mystery, Thriller & Suspense › …"). The author confirms them in KDP's category picker; never invent category IDs.`,
        "Subtitle: only if genuinely useful; otherwise null. Explain your choice.",
        "Audience, whether the book is sexually explicit, an honest content assessment, a minimum reader age if appropriate, and content warnings.",
        "Pricing: suggest a USD list price with reasoning based on length, genre norms and the 70% royalty band; the author decides.",
      ].join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function coverPrompt(
  book: Book,
  author: AuthorProfile | null,
  bible: StoryBible | null,
): PromptSpec {
  return {
    system: [
      "You are a book cover art director for genre fiction eBooks.",
      "Covers must read clearly as a small thumbnail, signal the genre honestly and avoid imitating existing covers, logos or trademarked characters.",
    ].join("\n"),
    prompt: [
      `Book: ${book.title}${book.subtitle ? ` — ${book.subtitle}` : ""}, by ${author?.penName ?? "the author"}. Genre: ${book.brief.genre}${book.brief.subgenre ? ` / ${book.brief.subgenre}` : ""}. Tone: ${book.brief.tones.join(", ") || "as the premise suggests"}. Audience: ${book.brief.audience ?? "adult genre readers"}.`,
      book.seriesName
        ? `Series branding: ${book.seriesName} #${book.seriesNumber ?? 1}; keep a look that can repeat across the series.`
        : "",
      author?.coverBranding ? `Author branding: ${author.coverBranding}` : "",
      bible
        ? `Premise: ${bible.premise}\nSetting: ${bible.settingRules.slice(0, 5).join("; ")}\nKey objects and motifs: ${bible.objects.map((item) => item.name).join(", ")}`
        : `Premise: ${book.brief.theme}`,
      [
        "Create 3 distinct cover concepts. For each:",
        "- mainPrompt: a detailed image-generation prompt for ARTWORK ONLY in portrait 1600×2560 (1:1.6). The artwork must contain no lettering, text, logos or watermarks; the real title and author name are added later with typography tools.",
        "- negativePrompt: what to exclude (text, letters, watermark, logos, extra limbs, etc.).",
        "- composition: focal point, depth, and where empty space is left for the title (top third) and author name (bottom).",
        "- palette, typography recommendations (font style, weight, case), text placement, and why it reads well at thumbnail size for this genre.",
      ].join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}
