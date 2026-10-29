import type {
  CoverConcept,
  StoryConcept,
  StoryProviderStatus,
} from "@ai-studio/contracts";
import {
  TextProviderAbortedError,
  TextProviderUnavailableError,
  type GeneratedProse,
  type GeneratedText,
  type TextCompletionRequest,
  type TextGenerationRequest,
  type TextProvider,
} from "@ai-studio/providers";

const concept = (index: number): StoryConcept => ({
  workingTitle: `The Glass Orchard ${index}`,
  logline:
    "A grieving widow returns to the orchard where her husband vanished and finds his diary still being written.",
  genrePositioning: "Psychological thriller with a domestic core",
  centralConflict:
    "Mara must prove her husband is alive while the town insists she killed him.",
  protagonist: "Mara Lind, 38, an orchard bookkeeper with a gap in her memory",
  emotionalStakes: "Her custody of her daughter and her own sanity",
  coreQuestion: "Who keeps writing in the diary?",
  hook: "A new diary entry appears dated the night after his funeral.",
  potentialEnding:
    "Bittersweet: the truth frees Mara but costs her the orchard.",
  originalityRisks: [
    "Gone Girl comparisons; this book centres the accused spouse's memory instead.",
  ],
});

export const coverConcept = (index: number): CoverConcept => ({
  name: `Orchard at dusk ${index}`,
  visualMotif: "A single glass apple on a branch",
  mainPrompt:
    "Portrait 1600x2560 artwork, misty apple orchard at dusk, a single glass apple glowing on a bare branch, no text, no letters",
  negativePrompt: "text, letters, watermark, logo",
  composition:
    "Apple in the centre, sky space in the top third for the title, darker ground for the author name",
  palette: ["slate blue", "amber", "bone white"],
  typography: {
    titleFont: "High-contrast serif, uppercase",
    authorFont: "Spaced sans serif",
    notes: "Title large enough for thumbnails",
  },
  textPlacement: "Title top third, author bottom",
  genreReadability:
    "Moody palette and single object read as psychological suspense at thumbnail size",
});

function prose(words: number, chapter: number, extra = ""): string {
  const sentences: string[] = [];
  let count = 0;
  let index = 0;
  while (count < words) {
    const sentence =
      index % 7 === 3
        ? `"You counted wrong," Tomas said, and Mara wrote the number ${chapter * 100 + index} beside the row.`
        : `Mara checked row ${index + 1} of the orchard ledger in chapter ${chapter} while the pickers argued about rain.`;
    sentences.push(sentence);
    count += sentence.split(/\s+/).length;
    index += 1;
  }
  const paragraphs: string[] = [];
  for (let start = 0; start < sentences.length; start += 4) {
    paragraphs.push(sentences.slice(start, start + 4).join(" "));
  }
  if (paragraphs.length > 3) paragraphs.splice(2, 0, "* * *");
  return `${extra}${paragraphs.join("\n\n")}`;
}

export type Failure =
  | { kind: "retryable"; times: number }
  | { kind: "permanent" }
  | { kind: "block" };

/**
 * Deterministic stand-in for Claude/OpenAI. It answers each schema with valid
 * data and writes prose of the requested length, so the real pipeline,
 * persistence and exporters run end to end without any network access.
 */
export class MockBookProvider implements TextProvider {
  readonly id: "anthropic" | "openai";
  readonly defaultModel: string;
  readonly calls: Array<{
    kind: "json" | "prose";
    schemaName?: string;
    prompt: string;
    system?: string;
    cachedContext?: string;
  }> = [];
  /** Fails prose calls whose prompt matches. */
  readonly failures = new Map<RegExp, Failure>();
  blocked: { release: () => void; reached: Promise<void> } | undefined;
  private readonly takes = new Map<number, number>();
  private reachedBlock: (() => void) | undefined;

  constructor(id: "anthropic" | "openai" = "anthropic") {
    this.id = id;
    this.defaultModel = id === "anthropic" ? "claude-opus-5-5" : "gpt-5.4-mini";
  }

  getStatus(): Promise<StoryProviderStatus> {
    return Promise.resolve({
      id: this.id,
      name: this.id === "anthropic" ? "Claude API" : "OpenAI API",
      mode: "cloud-paid",
      configured: true,
      available: true,
      model: this.defaultModel,
      message: "Mock provider",
    });
  }

  /** The next prose call matching `pattern` waits until released. */
  blockOn(pattern: RegExp): { release: () => void; reached: Promise<void> } {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>(
      (resolve) => (this.reachedBlock = resolve),
    );
    this.failures.set(pattern, { kind: "block" });
    this.blocked = { release, reached };
    (this.blocked as { gate?: Promise<void> }).gate = gate;
    return this.blocked;
  }

  private async maybeFail(prompt: string, signal?: AbortSignal): Promise<void> {
    for (const [pattern, failure] of this.failures) {
      if (!pattern.test(prompt)) continue;
      if (failure.kind === "permanent") {
        throw new TextProviderUnavailableError(
          "Mock provider rejected the key.",
          { retryable: false, status: 401 },
        );
      }
      if (failure.kind === "retryable" && failure.times > 0) {
        failure.times -= 1;
        throw new TextProviderUnavailableError("Mock rate limit.", {
          retryable: true,
          status: 429,
          retryAfterMs: 5,
        });
      }
      if (failure.kind === "block") {
        this.failures.delete(pattern);
        this.reachedBlock?.();
        const gate = (this.blocked as { gate?: Promise<void> } | undefined)
          ?.gate;
        await new Promise<void>((resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new TextProviderAbortedError()),
            { once: true },
          );
          void gate?.then(resolve);
        });
      }
    }
  }

  async complete(request: TextCompletionRequest): Promise<GeneratedProse> {
    this.calls.push({
      kind: "prose",
      prompt: request.prompt,
      system: request.system,
      cachedContext: request.cachedContext,
    });
    await this.maybeFail(request.prompt, request.signal);
    const chapter = Number(
      /Write chapter (\d+)|## Chapter card\nChapter (\d+)|Chapter to write now\nChapter (\d+)/
        .exec(request.prompt)
        ?.slice(1)
        .find(Boolean) ?? 1,
    );
    const target = Number(
      (
        /(?:about|planned) ([\d,]+) words/.exec(request.prompt)?.[1] ?? "300"
      ).replace(/,/g, ""),
    );
    let text: string;
    if (/Join these scene drafts/.test(request.prompt)) {
      text = request.prompt
        .split("## Scene drafts\n")[1]!
        .split("\n\nJoin these scene drafts")[0]!;
    } else if (/## Passage\n/.test(request.prompt)) {
      const passage = request.prompt
        .split("## Passage\n")[1]!
        .split("\n\n")[0]!;
      text = /Correct spelling/.test(request.prompt)
        ? passage.replace(/\bteh\b/g, "the")
        : `${passage} The wind turned the leaves silver.`;
    } else {
      const typo =
        chapter === 2 ? "Mara walked to teh harbour before dawn.\n\n" : "";
      // Each redraft differs, like a real model's.
      const take = (this.takes.get(chapter) ?? 0) + 1;
      this.takes.set(chapter, take);
      text = prose(
        Math.round(target * 0.95),
        chapter,
        `${typo}${take > 1 ? `Take ${take}: the rain had moved east.\n\n` : ""}`,
      );
    }
    return {
      text,
      model: this.defaultModel,
      truncated: false,
      usage: {
        inputTokens: Math.round(request.prompt.length / 4),
        outputTokens: Math.round(text.length / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }

  async generate(request: TextGenerationRequest): Promise<GeneratedText> {
    this.calls.push({
      kind: "json",
      schemaName: request.schemaName,
      prompt: request.prompt,
      system: request.system,
    });
    await this.maybeFail(request.prompt, request.signal);
    return {
      output: this.output(request),
      model: this.defaultModel,
      usage: {
        inputTokens: Math.round(request.prompt.length / 4),
        outputTokens: 800,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }

  private output(request: TextGenerationRequest): unknown {
    switch (request.schemaName) {
      case "story_concepts":
        return { concepts: [1, 2, 3].map(concept) };
      case "story_bible":
        return {
          premise: "Mara Lind must prove her vanished husband is alive.",
          theme: "Memory as evidence",
          settingRules: [
            "Present-day Swedish orchard town",
            "No phones work in the lower orchard",
          ],
          locations: [
            {
              name: "Lind orchard",
              description: "Forty rows of old apple trees",
              significance: "Where Jonas vanished",
            },
          ],
          characters: [
            {
              name: "Mara Lind",
              role: "protagonist",
              age: "38",
              description: "Orchard bookkeeper with a memory gap",
              physicalDetails: "Green eyes, a scar on her left palm",
              motivation: "Keep her daughter",
              fear: "That she did it",
              goal: "Find Jonas",
              secret: "She burned his letters",
              arc: "From doubt to self-trust",
              speechPattern: "Short, precise, deflects with numbers",
              relationships: [
                { with: "Tomas Berg", relation: "Foreman she distrusts" },
              ],
            },
            {
              name: "Tomas Berg",
              role: "antagonist",
              age: "45",
              description: "Orchard foreman",
              physicalDetails: null,
              motivation: "Buy the orchard",
              fear: "Exposure",
              goal: "Keep the diary going",
              secret: "He writes the diary",
              arc: "Unmasked",
              speechPattern: "Warm, over-familiar",
              relationships: [],
            },
          ],
          chronology: [
            {
              when: "Last autumn",
              event: "Jonas vanishes",
              characters: ["Jonas"],
              hiddenFromReader: false,
            },
          ],
          majorEvents: ["The diary entry appears"],
          objects: [
            {
              name: "The diary",
              description: "Green leather diary",
              significance: "Main clue",
            },
          ],
          clues: [
            {
              kind: "clue",
              description: "Ink smudge on the diary matches the orchard ledger",
              payoff: "Tomas writes both",
              plantChapter: 1,
              payoffChapter: 9,
            },
          ],
          viewpointRules: "Close third person on Mara, past tense",
          styleGuide: {
            narrativeVoice: "Restrained and precise",
            proseRules: ["Concrete detail"],
            dialogueRules: ["Subtext"],
            avoid: ["Pounding hearts"],
          },
          plotConstraints: ["Jonas is alive"],
          endingResolution: "Tomas confesses; Mara sells the orchard.",
          unresolvedQuestions: ["Does Mara forgive herself?"],
        };
      case "plot_architecture":
        return {
          structure: "Three-act",
          structureRationale: "Clean escalation for a short thriller",
          acts: [
            {
              name: "Act I",
              summary: "Diary appears",
              turningPoint: "Police reopen the case",
            },
            {
              name: "Act II",
              summary: "Mara investigates",
              turningPoint: "She finds the ledger",
            },
            {
              name: "Act III",
              summary: "Confrontation",
              turningPoint: "Tomas confesses",
            },
          ],
          beginning: "Return",
          middle: "Investigation",
          ending: "Confession",
          truthTimeline: [
            {
              when: "Last autumn",
              event: "Tomas hides Jonas",
              characters: ["Tomas"],
              hiddenFromReader: true,
            },
          ],
          suspects: [
            {
              name: "Tomas Berg",
              motive: "Land",
              opportunity: "Keys",
              isCulprit: true,
            },
          ],
          redHerrings: ["The neighbour's dog"],
          revealOrder: ["Ink", "Ledger", "Confession"],
          threatRules: [],
          relationshipArc: [],
          tensionNotes: ["Short chapters near the end"],
        };
      case "chapter_outline": {
        const single = /Return exactly one card/.test(request.prompt);
        const count = single
          ? 1
          : Number(
              /Write exactly (\d+) chapter cards/.exec(request.prompt)?.[1] ??
                3,
            );
        return {
          chapters: Array.from({ length: count }, (_, index) => ({
            title: single ? "Rewritten card" : `Row ${index + 1}`,
            povCharacter: "Mara Lind",
            location: "Lind orchard",
            time: `Day ${index + 1}`,
            objective: `Mara tests the diary claim number ${index + 1}`,
            openingHook: "A sound in the packing shed",
            scenes: [
              { summary: "Mara searches the shed", purpose: "Discovery" },
              { summary: "Tomas interrupts", purpose: "Conflict" },
            ],
            conflict: "Tomas blocks her",
            newInformation: ["The ink is fresh"],
            clues: index === 0 ? ["Ink smudge"] : [],
            continuityReferences: index > 0 ? [`Chapter ${index}`] : [],
            emotionalMovement: "Doubt to resolve",
            endingBeat: "She pockets the page",
            dependsOn: index > 1 ? [index - 1] : [],
          })),
        };
      }
      case "chapter_inspection": {
        const number = Number(
          /## Chapter (\d+) text/.exec(request.prompt)?.[1] ?? 1,
        );
        const contradiction =
          /blue eyes/.test(request.prompt) &&
          /Mara's eyes are green/.test(request.prompt)
            ? [
                {
                  severity: "major",
                  issue: "Mara's eye colour changes",
                  evidence: '"Mara blinked her blue eyes" vs canon: green eyes',
                  suggestion: "Change to green.",
                },
              ]
            : [];
        return {
          summary: `In chapter ${number} Mara checks the ledger and argues with Tomas.`,
          chronology: [
            { when: `Day ${number}`, event: `Ledger check ${number}` },
          ],
          newFacts:
            number === 1
              ? [{ fact: "Mara's eyes are green", category: "physical" }]
              : [{ fact: `Row ${number} was counted`, category: "event" }],
          characterStates: [
            { name: "Mara", state: `Suspicious after chapter ${number}` },
          ],
          clueUpdates:
            number === 1
              ? [
                  {
                    clue: "Ink smudge on the diary matches the ledger",
                    status: "planted",
                    note: "Seen in the shed",
                  },
                ]
              : [],
          contradictions: contradiction,
          repetitions: [],
          transitionNote: null,
          canonChanges:
            number === 3
              ? [
                  {
                    change: "Tomas now owns a second key",
                    reason: "Shown in the shed scene",
                  },
                ]
              : [],
        };
      }
      case "editorial_report": {
        const copy = /copy editor/.test(request.system ?? "");
        const continuity = /continuity editor/.test(request.system ?? "");
        const typo = /teh harbour/.test(request.prompt);
        if (
          continuity &&
          /blue eyes/.test(request.prompt) &&
          /Mara's eyes are green/.test(request.prompt)
        ) {
          return {
            summary: "One continuity error.",
            strengths: [],
            findings: [
              {
                severity: "major",
                issue: "Eye colour contradicts canon",
                chapterNumber: 5,
                location: "Chapter 5",
                evidence: "blue eyes vs green eyes",
                suggestion: "Use green.",
                originalText: "blue eyes",
                replacementText: "green eyes",
              },
            ],
          };
        }
        return {
          summary: copy ? "Clean copy with one typo." : "Solid structure.",
          strengths: ["Clear stakes"],
          findings:
            copy && typo
              ? [
                  {
                    severity: "minor",
                    issue: "Typo",
                    chapterNumber: 2,
                    location: "Chapter 2, opening",
                    evidence: "teh harbour",
                    suggestion: "the harbour",
                    originalText: "teh harbour",
                    replacementText: "the harbour",
                  },
                ]
              : [
                  {
                    severity: "suggestion",
                    issue: "Middle sags slightly",
                    chapterNumber: 5,
                    location: "Chapter 5",
                    evidence: "Repeated ledger checks",
                    suggestion: "Cut one check",
                    originalText: null,
                    replacementText: null,
                  },
                ],
        };
      }
      case "kdp_listing":
        return {
          description:
            "<p>Mara Lind buried an empty coffin. Now her husband's diary has a new entry.</p><p><b>Someone in the orchard is lying.</b></p>",
          keywords: [
            "psychological suspense",
            "missing husband mystery",
            "small town secrets",
            "unreliable memory",
            "orchard family drama",
            "domestic suspense",
            "scandinavian setting",
          ],
          categories: [
            {
              path: "Kindle Store › Kindle eBooks › Mystery, Thriller & Suspense › Thrillers › Psychological",
              rationale: "Core fit",
            },
            {
              path: "Kindle Store › Kindle eBooks › Mystery, Thriller & Suspense › Thrillers › Domestic",
              rationale: "Marriage at the centre",
            },
          ],
          subtitle: null,
          subtitleRationale: "The title is strong alone.",
          audience: "Adult readers of psychological suspense",
          sexuallyExplicit: false,
          explicitContentAssessment: "No sexual content; mild violence.",
          minimumReaderAge: null,
          contentWarnings: ["Grief"],
          pricingRationale: "Novella length in a competitive genre",
          suggestedPriceUsd: 2.99,
        };
      case "cover_concepts":
        return { concepts: [1, 2, 3].map(coverConcept) };
      default:
        throw new Error(`Unexpected schema ${request.schemaName}`);
    }
  }
}

/** Minimal JPEG header (SOI, APP0, SOF0) that image inspection can read. */
export function jpegHeader(
  width: number,
  height: number,
  components = 3,
): Buffer {
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
  ]);
  const sofLength = 8 + components * 3;
  const sof = Buffer.alloc(2 + sofLength);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(sofLength, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(components, 9);
  for (let index = 0; index < components; index += 1) {
    sof.writeUInt8(index + 1, 10 + index * 3);
    sof.writeUInt8(0x11, 11 + index * 3);
    sof.writeUInt8(0, 12 + index * 3);
  }
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

export function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header.writeUInt8(8, 24);
  header.writeUInt8(2, 25);
  return header;
}

export function multipart(
  filename: string,
  mimeType: string,
  data: Buffer,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----kdp-test-boundary";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}
