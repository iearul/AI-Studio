import { blocksToPlainText } from "@ai-film-studio/book-engine";
import type { InlineRun, ManuscriptBlock } from "@ai-film-studio/book-engine";

import { assertExportable, identifierUrn, tocEntries } from "./manuscript.js";
import type {
  ExportBookMeta,
  ExportManuscript,
  ExportSection,
} from "./manuscript.js";

/** A readable backup: YAML front matter, then the book as Markdown. */
export function buildMarkdown(manuscript: ExportManuscript): string {
  assertExportable(manuscript);
  const { meta, sections } = manuscript;
  const parts = [frontMatter(meta)];
  if (!sections.some((section) => section.kind === "title-page")) {
    parts.push(`# ${markdownInline(meta.title)}`);
  }
  for (const section of sections) {
    const body = markdownSection(manuscript, section);
    if (body) parts.push(body);
  }
  return `${parts.join("\n\n")}\n`;
}

export function buildPlainText(manuscript: ExportManuscript): string {
  assertExportable(manuscript);
  const { meta, sections } = manuscript;
  const parts: string[] = [];
  if (!sections.some((section) => section.kind === "title-page")) {
    parts.push(meta.title);
  }
  for (const section of sections) {
    const lines: string[] = [];
    if (section.kind === "title-page") {
      lines.push(meta.title);
      if (meta.subtitle?.trim()) lines.push(meta.subtitle);
      lines.push("", meta.authorName);
    } else {
      if (section.showHeading) lines.push(section.title, "");
      lines.push(
        section.kind === "toc"
          ? otherTocEntries(manuscript, section)
              .map((entry) => entry.title)
              .join("\n")
          : blocksToPlainText(section.blocks),
      );
    }
    const text = lines.join("\n").trim();
    if (text) parts.push(text);
  }
  return `${parts.join("\n\n\n")}\n`;
}

function frontMatter(meta: ExportBookMeta): string {
  // JSON strings are valid YAML double-quoted scalars, so escaping comes free.
  const quote = (value: string) => JSON.stringify(value);
  const fields: Array<[string, string | null]> = [
    ["title", quote(meta.title)],
    ["subtitle", meta.subtitle ? quote(meta.subtitle) : null],
    ["author", quote(meta.authorName)],
    ["language", quote(meta.language)],
    ["identifier", quote(identifierUrn(meta.identifier))],
    ["publisher", meta.publisher ? quote(meta.publisher) : null],
    ["series", meta.seriesName ? quote(meta.seriesName) : null],
    [
      "series_number",
      meta.seriesName && meta.seriesNumber !== null
        ? String(meta.seriesNumber)
        : null,
    ],
    ["rights", meta.rights ? quote(meta.rights) : null],
    [
      "subjects",
      meta.subjects.length > 0
        ? `[${meta.subjects.map(quote).join(", ")}]`
        : null,
    ],
    ["modified", quote(meta.modifiedAt)],
    ["description", meta.description ? quote(meta.description) : null],
  ];
  return [
    "---",
    ...fields.flatMap(([key, value]) =>
      value === null ? [] : [`${key}: ${value}`],
    ),
    "---",
  ].join("\n");
}

function markdownSection(
  manuscript: ExportManuscript,
  section: ExportSection,
): string {
  const { meta } = manuscript;
  if (section.kind === "title-page") {
    return [
      `# ${markdownInline(meta.title)}`,
      ...(meta.subtitle?.trim()
        ? [`*${markdownInline(meta.subtitle.trim())}*`]
        : []),
      markdownInline(meta.authorName),
    ].join("\n\n");
  }
  const parts: string[] = [];
  if (section.showHeading) parts.push(`## ${markdownInline(section.title)}`);
  if (section.kind === "toc") {
    const entries = otherTocEntries(manuscript, section);
    if (entries.length > 0) {
      parts.push(
        entries.map((entry) => `- ${markdownInline(entry.title)}`).join("\n"),
      );
    }
  } else {
    parts.push(...section.blocks.map(markdownBlock));
  }
  return parts.join("\n\n");
}

function otherTocEntries(
  manuscript: ExportManuscript,
  self: ExportSection,
): ExportSection[] {
  return tocEntries(manuscript).filter((section) => section.id !== self.id);
}

function markdownBlock(block: ManuscriptBlock): string {
  if (block.type === "scene-break") return "* * *";
  return (
    markdownRuns(block.runs)
      .split("\n")
      .map(escapeLineStart)
      // A backslash before the newline is CommonMark's visible hard break.
      .join("\\\n")
  );
}

function markdownRuns(runs: InlineRun[]): string {
  return runs
    .map((run) => {
      // Emphasis cannot open or close on whitespace, so spaces stay outside.
      const leading = /^\s*/.exec(run.text)?.[0] ?? "";
      const trailing = /\s*$/.exec(run.text)?.[0] ?? "";
      const core = run.text.slice(
        leading.length,
        run.text.length - trailing.length,
      );
      if (!core || (!run.italic && !run.bold)) return markdownInline(run.text);
      const marker = run.bold && run.italic ? "***" : run.bold ? "**" : "*";
      return `${leading}${marker}${markdownInline(core)}${marker}${trailing}`;
    })
    .join("");
}

function markdownInline(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, "\\$&");
}

/** Keeps a line that starts like a heading, quote or list item a paragraph. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)([#>+=|-])/, "$1\\$2")
    .replace(/^(\s*\d+)([.)])(\s)/, "$1\\$2$3");
}
