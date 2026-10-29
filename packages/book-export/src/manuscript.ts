import type { ManuscriptBlock } from "@ai-studio/book-engine";

export type ExportBookMeta = {
  /** Stable UUID; written as `urn:uuid:…`. */
  identifier: string;
  title: string;
  subtitle: string | null;
  /** Pen name. */
  authorName: string;
  /** BCP 47 tag, e.g. "en" or "de". */
  language: string;
  publisher: string | null;
  /** Plain text. */
  description: string | null;
  seriesName: string | null;
  seriesNumber: number | null;
  /** E.g. "Copyright © 2026 V. K. Rabenhorst". */
  rights: string | null;
  subjects: string[];
  /** ISO timestamp. */
  modifiedAt: string;
};

export type ExportSectionKind =
  | "title-page"
  | "copyright"
  | "dedication"
  | "content-notice"
  | "toc"
  | "chapter"
  | "epilogue"
  | "about-author"
  | "next-book-preview"
  | "call-to-action"
  | "custom";

export type ExportSection = {
  /** Stable slug, unique within the book, `[a-z0-9-]`. */
  id: string;
  kind: ExportSectionKind;
  role: "front" | "body" | "back";
  /** Heading text, e.g. "Chapter 1: The Night Ferry". */
  title: string;
  showHeading: boolean;
  includeInToc: boolean;
  /** Empty for the title page and the table of contents (both generated). */
  blocks: ManuscriptBlock[];
};

export type ExportManuscript = {
  meta: ExportBookMeta;
  sections: ExportSection[];
};

const sectionIdPattern = /^[a-z0-9-]+$/;

/** Throws on input every exporter would turn into a broken file. */
export function assertExportable(manuscript: ExportManuscript): void {
  const { meta, sections } = manuscript;
  if (!meta.title.trim()) throw new Error("The book needs a title.");
  if (!meta.language.trim()) throw new Error("The book needs a language.");
  if (!meta.identifier.trim()) throw new Error("The book needs an identifier.");
  formatModified(meta.modifiedAt);
  if (sections.length === 0) {
    throw new Error("The book needs at least one section.");
  }
  const seen = new Set<string>();
  for (const section of sections) {
    if (!sectionIdPattern.test(section.id)) {
      throw new Error(
        `Section id "${section.id}" may only contain a-z, 0-9 and "-".`,
      );
    }
    if (seen.has(section.id)) {
      throw new Error(`Section id "${section.id}" is used twice.`);
    }
    seen.add(section.id);
  }
}

/** `YYYY-MM-DDThh:mm:ssZ`, the only form `dcterms:modified` accepts. */
export function formatModified(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`"${timestamp}" is not a valid timestamp.`);
  }
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function identifierUrn(identifier: string): string {
  const trimmed = identifier.trim();
  return /^urn:/i.test(trimmed) ? trimmed : `urn:uuid:${trimmed.toLowerCase()}`;
}

/**
 * Sections listed in a table of contents. Readers and Kindle require a logical
 * TOC with at least one entry, so a book that marks nothing falls back to all
 * sections.
 */
export function tocEntries(manuscript: ExportManuscript): ExportSection[] {
  const marked = manuscript.sections.filter((section) => section.includeInToc);
  return marked.length > 0 ? marked : manuscript.sections;
}

type Labels = {
  contents: string;
  landmarks: string;
  cover: string;
  beginReading: string;
};

const englishLabels: Labels = {
  contents: "Contents",
  landmarks: "Landmarks",
  cover: "Cover",
  beginReading: "Begin Reading",
};

const labelsByLanguage: Record<string, Labels> = {
  en: englishLabels,
  de: {
    contents: "Inhalt",
    landmarks: "Orientierung",
    cover: "Cover",
    beginReading: "Lesen beginnen",
  },
};

/** Labels for generated navigation; unknown languages fall back to English. */
export function labelsFor(language: string): Labels {
  const base = language.toLowerCase().split("-")[0] ?? "";
  return labelsByLanguage[base] ?? englishLabels;
}
