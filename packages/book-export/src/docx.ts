import type { InlineRun, ManuscriptBlock } from "@ai-film-studio/book-engine";
import {
  AlignmentType,
  Bookmark,
  Document,
  HeadingLevel,
  InternalHyperlink,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { IParagraphOptions, IStylesOptions, ParagraphChild } from "docx";

import { assertExportable, formatModified, tocEntries } from "./manuscript.js";
import type {
  ExportBookMeta,
  ExportManuscript,
  ExportSection,
} from "./manuscript.js";
import { xmlText } from "./xml.js";
import { buildZip, readZip } from "./zip.js";

/** Twentieths of a point: 0.3 inch, a common novel first-line indent. */
const firstLineIndent = 432;

/**
 * A clean manuscript for Word and Kindle Create: semantic styles, real
 * paragraphs, a page break before every section and a TOC made of internal
 * links, so nothing depends on Word updating fields.
 */
export async function buildDocx(
  manuscript: ExportManuscript,
): Promise<Uint8Array> {
  assertExportable(manuscript);
  const { meta } = manuscript;
  const anchors = new Map(
    manuscript.sections.map((section, index) => [
      section.id,
      bookmarkName(section, index),
    ]),
  );
  const paragraphs = manuscript.sections.flatMap((section, index) =>
    sectionParagraphs(manuscript, section, anchors, index > 0),
  );
  const document = new Document({
    title: meta.title,
    subject: meta.subtitle ?? undefined,
    creator: meta.authorName,
    lastModifiedBy: meta.authorName,
    description: meta.description ?? undefined,
    keywords: meta.subjects.join(", ") || undefined,
    styles: styles(meta),
    sections: [{ children: paragraphs }],
  });
  const packed = new Uint8Array(await Packer.toArrayBuffer(document));
  return finalizePackage(packed, meta);
}

/**
 * Word bookmark names must start with a letter, use only letters, digits and
 * underscores, and stay within 40 characters; the index keeps truncated names
 * unique.
 */
function bookmarkName(section: ExportSection, index: number): string {
  return `s${index + 1}_${section.id.replace(/-/g, "_")}`.slice(0, 40);
}

function styles(meta: ExportBookMeta): IStylesOptions {
  const centered = {
    alignment: AlignmentType.CENTER,
    indent: { firstLine: 0 },
  };
  return {
    default: {
      document: {
        run: { font: "Georgia", size: 24, language: { value: meta.language } },
        paragraph: { spacing: { line: 276 } },
      },
      title: {
        run: { font: "Georgia", size: 56, bold: true, color: "000000" },
        paragraph: { ...centered, spacing: { before: 2880, after: 240 } },
      },
      heading1: {
        run: { font: "Georgia", size: 32, bold: true, color: "000000" },
        paragraph: {
          ...centered,
          spacing: { before: 1440, after: 480 },
          keepNext: true,
          keepLines: true,
          // Word's navigation pane and Kindle Create read chapters from it.
          outlineLevel: 0,
        },
      },
    },
    paragraphStyles: [
      {
        id: "Normal",
        name: "Normal",
        quickFormat: true,
        paragraph: {
          indent: { firstLine: firstLineIndent },
          spacing: { before: 0, after: 0 },
        },
      },
      {
        id: "FirstParagraph",
        name: "First Paragraph",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        paragraph: { indent: { firstLine: 0 } },
      },
      {
        id: "Subtitle",
        name: "Subtitle",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 32, italics: true },
        paragraph: { ...centered, spacing: { after: 480 } },
      },
      {
        id: "Author",
        name: "Author",
        basedOn: "Normal",
        next: "Normal",
        run: { size: 28 },
        paragraph: { ...centered, spacing: { before: 960 } },
      },
      {
        id: "SceneBreak",
        name: "Scene Break",
        basedOn: "Normal",
        next: "FirstParagraph",
        quickFormat: true,
        paragraph: { ...centered, spacing: { before: 240, after: 240 } },
      },
      {
        id: "TocEntry",
        name: "TOC Entry",
        basedOn: "Normal",
        next: "TocEntry",
        paragraph: { indent: { firstLine: 0 }, spacing: { after: 120 } },
      },
    ],
  };
}

function sectionParagraphs(
  manuscript: ExportManuscript,
  section: ExportSection,
  anchors: Map<string, string>,
  newPage: boolean,
): Paragraph[] {
  const anchor = anchors.get(section.id) ?? section.id;
  const { meta } = manuscript;
  const options: IParagraphOptions[] = [];
  let bookmarked = false;
  const bookmark = (children: ParagraphChild[]): ParagraphChild[] => {
    if (bookmarked) return children;
    bookmarked = true;
    return [new Bookmark({ id: anchor, children })];
  };

  if (section.kind === "title-page") {
    options.push({
      heading: HeadingLevel.TITLE,
      children: bookmark([new TextRun(meta.title)]),
    });
    if (meta.subtitle?.trim()) {
      options.push({
        style: "Subtitle",
        children: [new TextRun(meta.subtitle)],
      });
    }
    options.push({ style: "Author", children: [new TextRun(meta.authorName)] });
  } else {
    if (section.showHeading) {
      options.push({
        heading: HeadingLevel.HEADING_1,
        children: bookmark([new TextRun(section.title)]),
      });
    }
    const body =
      section.kind === "toc"
        ? tocParagraphs(manuscript, section, anchors)
        : blockParagraphs(section.blocks);
    for (const paragraph of body) {
      options.push(
        bookmarked
          ? paragraph
          : {
              ...paragraph,
              children: bookmark([...(paragraph.children ?? [])]),
            },
      );
    }
  }
  // A section with no text still needs a target for its TOC link.
  if (!bookmarked) options.push({ children: bookmark([]) });

  return options.map(
    (paragraph, index) =>
      new Paragraph(
        index === 0 && newPage
          ? { ...paragraph, pageBreakBefore: true }
          : paragraph,
      ),
  );
}

function tocParagraphs(
  manuscript: ExportManuscript,
  self: ExportSection,
  anchors: Map<string, string>,
): IParagraphOptions[] {
  return tocEntries(manuscript)
    .filter((section) => section.id !== self.id)
    .map((section) => ({
      style: "TocEntry",
      children: [
        new InternalHyperlink({
          anchor: anchors.get(section.id) ?? section.id,
          children: [new TextRun({ text: section.title, style: "Hyperlink" })],
        }),
      ],
    }));
}

function blockParagraphs(blocks: ManuscriptBlock[]): IParagraphOptions[] {
  const paragraphs: IParagraphOptions[] = [];
  let first = true;
  for (const block of blocks) {
    if (block.type === "scene-break") {
      paragraphs.push({
        style: "SceneBreak",
        children: [new TextRun("* * *")],
      });
      first = true;
      continue;
    }
    paragraphs.push({
      ...(first ? { style: "FirstParagraph" } : {}),
      children: runs(block.runs),
    });
    first = false;
  }
  return paragraphs;
}

function runs(inline: InlineRun[]): TextRun[] {
  return inline.flatMap((run) =>
    run.text.split("\n").map(
      (line, index) =>
        new TextRun({
          text: line,
          italics: run.italic || undefined,
          bold: run.bold || undefined,
          ...(index > 0 ? { break: 1 } : {}),
        }),
    ),
  );
}

/**
 * The docx library stamps the current time, numbers bookmarks from a
 * process-wide counter and has no language property. Rewriting those parts and
 * repacking with fixed timestamps makes the same manuscript give the same bytes.
 */
function finalizePackage(packed: Uint8Array, meta: ExportBookMeta): Uint8Array {
  const files = readZip(packed);
  const documentPath = "word/document.xml";
  const document = files.get(documentPath);
  if (document) {
    files.set(
      documentPath,
      new TextEncoder().encode(
        renumberBookmarks(new TextDecoder().decode(document)),
      ),
    );
  }
  const corePath = "docProps/core.xml";
  const core = files.get(corePath);
  if (core) {
    const modified = formatModified(meta.modifiedAt);
    let xml = new TextDecoder()
      .decode(core)
      .replace(
        /(<dcterms:(created|modified)\b[^>]*>)[^<]*(<\/dcterms:\2>)/g,
        `$1${modified}$3`,
      );
    if (!xml.includes("<dc:language>")) {
      xml = xml.replace(
        "</cp:coreProperties>",
        `<dc:language>${xmlText(meta.language)}</dc:language></cp:coreProperties>`,
      );
    }
    files.set(corePath, new TextEncoder().encode(xml));
  }
  // Office writes the content types and package relationships first; some
  // tools expect that order.
  const leading = ["[Content_Types].xml", "_rels/.rels"];
  const ordered = [
    ...leading.filter((path) => files.has(path)),
    ...[...files.keys()].filter((path) => !leading.includes(path)),
  ];
  return buildZip(
    ordered.map((path) => ({
      path,
      data: files.get(path) ?? new Uint8Array(),
    })),
  );
}

function renumberBookmarks(xml: string): string {
  const ids = new Map<string, number>();
  return xml.replace(
    /(<w:bookmark(?:Start|End)\b[^>]*?\bw:id=")(\d+)(")/g,
    (_match, before: string, id: string, after: string) => {
      let next = ids.get(id);
      if (next === undefined) {
        next = ids.size + 1;
        ids.set(id, next);
      }
      return `${before}${next}${after}`;
    },
  );
}
