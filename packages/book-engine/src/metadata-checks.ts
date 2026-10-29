import type { BookMetadata } from "@ai-film-studio/contracts";

import { kdpRules } from "./kdp-rules.js";

export type MetadataFinding = {
  field: string;
  level: "error" | "warning";
  message: string;
};

const promotionalTerms =
  /\b(free|bestsell(?:er|ing)|best[- ]sell(?:er|ing)|#\s?1|number one|new release|on sale|sale|discount|limited time|kindle unlimited|kindle\+|kdp select|amazon|kindle)\b/i;
const unverifiableClaims =
  /\b(award[- ]winning|bestsell(?:er|ing)|best[- ]sell(?:er|ing)|#\s?1|critically acclaimed|usa today|new york times)\b/i;
const affiliationPhrases =
  /\b(in the style of|for fans of|perfect for fans|if you (?:loved|liked|enjoyed)|the next [A-Z][a-z]+ [A-Z][a-z]+)\b/i;
const urlPattern = /\b(?:https?:\/\/|www\.)\S+/i;
const emailPattern = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/;
const phonePattern = /\+?\d[\d\s().-]{8,}\d/;
const emojiPattern = /\p{Extended_Pictographic}/u;
const reviewPattern =
  /(★|☆|\b\d(?:\.\d)? stars?\b|\bpraise for\b|\breviewers? (?:say|call)\b|["“][^"”]{10,}["”]\s*[—–-]\s*[A-Z])/i;

export function descriptionTags(description: string): string[] {
  return [...description.matchAll(/<\/?\s*([a-zA-Z0-9]+)[^>]*>/g)].map(
    (match) => match[1]!.toLowerCase(),
  );
}

export function checkMetadata(metadata: BookMetadata): MetadataFinding[] {
  const findings: MetadataFinding[] = [];
  const rules = kdpRules.metadata;
  const add = (
    field: string,
    level: MetadataFinding["level"],
    message: string,
  ) => findings.push({ field, level, message });

  if (!metadata.title.trim()) add("title", "error", "The title is required.");
  const titleLength =
    metadata.title.trim().length + (metadata.subtitle?.trim().length ?? 0);
  if (titleLength > rules.titlePlusSubtitleMaxChars) {
    add(
      "title",
      "error",
      `Title and subtitle together are ${titleLength} characters; KDP allows fewer than 200.`,
    );
  }
  for (const [field, value] of [
    ["title", metadata.title],
    ["subtitle", metadata.subtitle ?? ""],
  ] as const) {
    if (/<[^>]+>/.test(value)) add(field, "error", "HTML is not allowed here.");
    if (promotionalTerms.test(value)) {
      add(
        field,
        "error",
        "Remove promotional or store terms (for example free, bestseller, Kindle, sale).",
      );
    }
  }
  if (
    metadata.subtitle &&
    /\b(book|volume|vol\.?|part)\s+\d+\b|\bseries\b/i.test(metadata.subtitle)
  ) {
    add(
      "subtitle",
      "warning",
      "Series information belongs in the series fields, not the subtitle.",
    );
  }
  if (!metadata.penName.trim())
    add("penName", "error", "The author name is required.");

  // Description
  const description = metadata.description.trim();
  if (!description) add("description", "error", "The description is required.");
  if (description.length > rules.descriptionMaxChars) {
    add(
      "description",
      "error",
      `The description is ${description.length} characters including HTML; the limit is ${rules.descriptionMaxChars}.`,
    );
  }
  const disallowedTags = [
    ...new Set(
      descriptionTags(description).filter(
        (tag) =>
          !(rules.descriptionAllowedTags as readonly string[]).includes(tag),
      ),
    ),
  ];
  if (disallowedTags.length > 0) {
    add(
      "description",
      "error",
      `These HTML tags are not supported in KDP descriptions: ${disallowedTags.join(", ")}.`,
    );
  }
  if (
    urlPattern.test(description) ||
    emailPattern.test(description) ||
    phonePattern.test(description)
  ) {
    add(
      "description",
      "error",
      "Remove web addresses, email addresses and phone numbers.",
    );
  }
  if (emojiPattern.test(description))
    add("description", "error", "Remove emoji.");
  if (reviewPattern.test(description)) {
    add(
      "description",
      "error",
      "Do not include reviews, ratings, quotes or testimonials.",
    );
  }
  if (
    /\b(limited time|on sale|price drop|free (?:today|this week)|ends soon)\b/i.test(
      description,
    )
  ) {
    add("description", "error", "Remove time-sensitive or price information.");
  }
  if (unverifiableClaims.test(description)) {
    add(
      "description",
      "error",
      "Claims such as bestseller or award-winning must be true and verifiable; remove them unless they are.",
    );
  }
  if (affiliationPhrases.test(description)) {
    add(
      "description",
      "warning",
      "Comparisons with other authors or books can imply an affiliation. Check that this wording is necessary and accurate.",
    );
  }

  // Keywords
  const keywords = metadata.keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  if (keywords.length === 0)
    add("keywords", "warning", "Add up to seven keyword phrases.");
  if (keywords.length > rules.keywordsMax) {
    add(
      "keywords",
      "error",
      `KDP accepts at most ${rules.keywordsMax} keywords.`,
    );
  }
  const seen = new Set<string>();
  const titleWords = new Set(
    metadata.title
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 3),
  );
  for (const keyword of keywords) {
    const lower = keyword.toLowerCase();
    if (seen.has(lower))
      add("keywords", "warning", `"${keyword}" is listed twice.`);
    seen.add(lower);
    if (keyword.length > rules.keywordSoftMaxChars) {
      add(
        "keywords",
        "warning",
        `"${keyword}" is ${keyword.length} characters; long keyword phrases may be cut.`,
      );
    }
    if (promotionalTerms.test(keyword) || /["<>]/.test(keyword)) {
      add(
        "keywords",
        "error",
        `"${keyword}" uses quotes, HTML or store/promotional terms that KDP prohibits in keywords.`,
      );
    }
    if (lower.split(/\W+/).every((word) => !word || titleWords.has(word))) {
      add(
        "keywords",
        "warning",
        `"${keyword}" only repeats words from the title.`,
      );
    }
  }

  if (metadata.categories.length === 0) {
    add("categories", "warning", "Choose up to three categories in KDP.");
  }
  if (metadata.categories.length > rules.categoriesMax) {
    add(
      "categories",
      "error",
      `KDP accepts at most ${rules.categoriesMax} categories.`,
    );
  }
  if (metadata.imprint && metadata.imprint.length > rules.imprintMaxChars) {
    add(
      "imprint",
      "error",
      `The imprint can have at most ${rules.imprintMaxChars} characters.`,
    );
  }
  if (metadata.seriesName && metadata.seriesNumber === null) {
    add("seriesNumber", "warning", "Add the book's number in the series.");
  }
  return findings;
}

export type IdentityValues = {
  title: string;
  subtitle: string | null;
  author: string;
  seriesName: string | null;
  seriesNumber: number | null;
};

function same(a: string | null | undefined, b: string | null | undefined) {
  const normalize = (value: string | null | undefined) =>
    (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(a) === normalize(b);
}

/** Title, subtitle, author and series must match across every source. */
export function checkIdentityConsistency(
  sources: Array<{ name: string; values: Partial<IdentityValues> }>,
): MetadataFinding[] {
  const findings: MetadataFinding[] = [];
  const fields: Array<keyof IdentityValues> = [
    "title",
    "subtitle",
    "author",
    "seriesName",
    "seriesNumber",
  ];
  const [reference, ...others] = sources;
  if (!reference) return findings;
  for (const field of fields) {
    if (!(field in reference.values)) continue;
    for (const other of others) {
      if (!(field in other.values)) continue;
      const left = reference.values[field];
      const right = other.values[field];
      if (
        !same(
          left === null || left === undefined ? null : String(left),
          right === null || right === undefined ? null : String(right),
        )
      ) {
        findings.push({
          field,
          level: "error",
          message: `${field} differs: ${reference.name} has "${left ?? "—"}", ${other.name} has "${right ?? "—"}".`,
        });
      }
    }
  }
  return findings;
}
