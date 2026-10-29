import type { IssueSeverity } from "@ai-film-studio/contracts";

import { aiPhraseWatchlist, clicheWatchlist } from "./craft.js";
import { countWords, manuscriptToPlainText } from "./markup.js";

export type StyleFinding = {
  chapterNumber: number | null;
  severity: IssueSeverity;
  issue: string;
  location: string;
  evidence: string;
  suggestion: string;
};

export type LintChapter = { number: number; content: string };

const perThousand = (count: number, words: number) =>
  words === 0 ? 0 : (count * 1000) / words;

function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…])["”’)]?\s+(?=["“‘(]?[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function narrationOnly(text: string): string {
  return text.replace(/["“][^"”]*["”]/g, " ");
}

function excerpt(text: string, index: number, radius = 70): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

function lintChapter(chapter: LintChapter): StyleFinding[] {
  const findings: StyleFinding[] = [];
  const text = manuscriptToPlainText(chapter.content);
  const words = countWords(text);
  if (words < 150) return findings;
  const location = `Chapter ${chapter.number}`;
  const push = (finding: Omit<StyleFinding, "chapterNumber" | "location">) =>
    findings.push({ chapterNumber: chapter.number, location, ...finding });

  const dashes = (text.match(/—|–(?=\s)|\s--\s/g) ?? []).length;
  if (perThousand(dashes, words) > 5) {
    push({
      severity: "minor",
      issue: "Em dashes are frequent",
      evidence: `${dashes} dashes in ${words} words (${perThousand(dashes, words).toFixed(1)} per 1,000).`,
      suggestion:
        "Recast most dashes as commas, full stops or restructured sentences.",
    });
  }
  const ellipses = (text.match(/…|\.\.\./g) ?? []).length;
  if (perThousand(ellipses, words) > 2) {
    push({
      severity: "minor",
      issue: "Ellipses are frequent",
      evidence: `${ellipses} ellipses in ${words} words.`,
      suggestion:
        "Keep ellipses for trailing speech; end other sentences cleanly.",
    });
  }
  const narration = narrationOnly(text);
  const questions = (narration.match(/\?/g) ?? []).length;
  if (perThousand(questions, words) > 3) {
    push({
      severity: "minor",
      issue: "Many rhetorical questions in narration",
      evidence: `${questions} questions outside dialogue.`,
      suggestion:
        "Turn the character's questions into actions, decisions or concrete observations.",
    });
  }
  const sentenceList = sentences(narration);
  const lengths = sentenceList.map((sentence) => countWords(sentence));
  if (lengths.length >= 20) {
    const fragments = lengths.filter(
      (length) => length > 0 && length <= 3,
    ).length;
    if (fragments / lengths.length > 0.18) {
      push({
        severity: "minor",
        issue: "Many dramatic fragments",
        evidence: `${fragments} of ${lengths.length} narrative sentences have three words or fewer.`,
        suggestion:
          "Keep fragments for real impact; merge the rest into full sentences.",
      });
    }
    const mean =
      lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    const deviation = Math.sqrt(
      lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        lengths.length,
    );
    if (deviation < 4) {
      push({
        severity: "suggestion",
        issue: "Sentence rhythm is uniform",
        evidence: `Average ${mean.toFixed(1)} words per sentence with little variation (σ ${deviation.toFixed(1)}).`,
        suggestion: "Vary sentence length where the scene's pace changes.",
      });
    }
  }
  for (const cliche of clicheWatchlist) {
    const matches = [...text.matchAll(new RegExp(cliche.pattern.source, "gi"))];
    if (matches.length >= 2) {
      push({
        severity: "minor",
        issue: `Repeated genre cliché: ${cliche.label}`,
        evidence: `${matches.length}×, e.g. "${excerpt(text, matches[0]!.index ?? 0, 50)}"`,
        suggestion:
          "Replace with a specific physical or behavioural detail unique to this character.",
      });
    }
  }
  for (const phrase of aiPhraseWatchlist) {
    const match = new RegExp(phrase.source, "i").exec(text);
    if (match) {
      push({
        severity: "minor",
        issue: `Stock phrasing: "${match[0]}"`,
        evidence: excerpt(text, match.index),
        suggestion:
          "Rewrite with a concrete image or a direct statement of what happens.",
      });
    }
  }
  const grams = new Map<string, number>();
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  for (let index = 0; index + 5 <= tokens.length; index += 1) {
    const key = tokens.slice(index, index + 5).join(" ");
    grams.set(key, (grams.get(key) ?? 0) + 1);
  }
  const repeated = [...grams.entries()]
    .filter(
      ([key, count]) => count >= 3 && !/^(?:the|a|and|of|to|in) /.test(key),
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (repeated.length > 0) {
    push({
      severity: "minor",
      issue: "Repeated phrases",
      evidence: repeated.map(([key, count]) => `"${key}" ×${count}`).join("; "),
      suggestion: "Vary or cut repeated wording unless the echo is deliberate.",
    });
  }
  return findings;
}

function firstSentence(content: string): string {
  return sentences(manuscriptToPlainText(content))[0] ?? "";
}

function lastParagraph(content: string): string {
  const paragraphs = manuscriptToPlainText(content).split("\n\n");
  return paragraphs[paragraphs.length - 1] ?? "";
}

/** Deterministic prose checks that cost nothing and run on every chapter. */
export function lintManuscript(chapters: LintChapter[]): StyleFinding[] {
  const findings = chapters.flatMap(lintChapter);
  const written = chapters.filter(
    (chapter) => countWords(chapter.content) >= 150,
  );
  if (written.length >= 4) {
    const shortEndings = written.filter((chapter) => {
      const ending = lastParagraph(chapter.content);
      return countWords(ending) <= 8;
    });
    if (shortEndings.length / written.length > 0.6) {
      findings.push({
        chapterNumber: null,
        severity: "major",
        issue: "Chapters end the same way",
        location: `Chapters ${shortEndings.map((chapter) => chapter.number).join(", ")}`,
        evidence: `${shortEndings.length} of ${written.length} chapters end on a one-line paragraph.`,
        suggestion:
          "Vary chapter endings: resolution, quiet aftermath, decision, or a cliffhanger only where earned.",
      });
    }
    const openings = new Map<string, number[]>();
    for (const chapter of written) {
      const opening = firstSentence(chapter.content)
        .toLowerCase()
        .match(/[\p{L}']+/gu)
        ?.slice(0, 2)
        .join(" ");
      if (opening)
        openings.set(opening, [
          ...(openings.get(opening) ?? []),
          chapter.number,
        ]);
    }
    for (const [opening, numbers] of openings) {
      if (numbers.length >= 3) {
        findings.push({
          chapterNumber: null,
          severity: "minor",
          issue: "Chapters open with the same words",
          location: `Chapters ${numbers.join(", ")}`,
          evidence: `${numbers.length} chapters begin "${opening} …".`,
          suggestion:
            "Vary chapter openings: dialogue, action, setting, or a character decision.",
        });
      }
    }
  }
  return findings;
}
