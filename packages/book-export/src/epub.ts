import type { InlineRun, ManuscriptBlock } from "@ai-studio/book-engine";

import { bookCss } from "./epub-css.js";
import {
  assertExportable,
  formatModified,
  identifierUrn,
  labelsFor,
  tocEntries,
} from "./manuscript.js";
import type {
  ExportBookMeta,
  ExportManuscript,
  ExportSection,
  ExportSectionKind,
} from "./manuscript.js";
import { xmlAttr, xmlText } from "./xml.js";
import { buildZip } from "./zip.js";
import type { ZipEntry } from "./zip.js";

export type EpubCover = {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
};

export type BuildEpubOptions = {
  /**
   * KDP adds the cover uploaded during setup and asks for none inside the
   * manuscript, so a cover is only embedded on request.
   */
  cover?: EpubCover;
};

/** EPUB Structural Semantics for each section kind; `null` has no match. */
const sectionTypes: Record<ExportSectionKind, string | null> = {
  "title-page": "titlepage",
  copyright: "copyright-page",
  dedication: "dedication",
  "content-notice": "preamble",
  toc: "toc",
  chapter: "chapter",
  epilogue: "epilogue",
  "about-author": null,
  "next-book-preview": null,
  "call-to-action": null,
  custom: null,
};

const roleTypes: Record<ExportSection["role"], string> = {
  front: "frontmatter",
  body: "bodymatter",
  back: "backmatter",
};

type CoverFile = EpubCover & { href: string };

export function buildEpub(
  manuscript: ExportManuscript,
  options: BuildEpubOptions = {},
): Uint8Array {
  assertExportable(manuscript);
  const cover: CoverFile | null = options.cover
    ? {
        ...options.cover,
        href: `images/cover.${options.cover.mimeType === "image/png" ? "png" : "jpg"}`,
      }
    : null;
  const entries: ZipEntry[] = [
    { path: "mimetype", data: "application/epub+zip", store: true },
    { path: "META-INF/container.xml", data: containerXml },
    { path: "OEBPS/content.opf", data: packageDocument(manuscript, cover) },
    { path: "OEBPS/nav.xhtml", data: navDocument(manuscript, cover) },
    { path: "OEBPS/toc.ncx", data: ncxDocument(manuscript) },
    { path: "OEBPS/styles/book.css", data: bookCss },
  ];
  if (cover) {
    // Images are already compressed; deflating them again only costs time.
    entries.push(
      { path: `OEBPS/${cover.href}`, data: cover.bytes, store: true },
      {
        path: "OEBPS/cover.xhtml",
        data: coverDocument(manuscript.meta, cover),
      },
    );
  }
  for (const section of manuscript.sections) {
    entries.push({
      path: `OEBPS/${sectionHref(section)}`,
      data: sectionDocument(manuscript, section),
    });
  }
  return buildZip(entries);
}

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

function sectionHref(section: ExportSection): string {
  return `text/${section.id}.xhtml`;
}

/** Manifest ids must be XML names, which cannot start with a digit. */
function manifestId(section: ExportSection): string {
  return `sec-${section.id}`;
}

function packageDocument(
  manuscript: ExportManuscript,
  cover: CoverFile | null,
): string {
  const { meta } = manuscript;
  const metadata = [
    `<dc:identifier id="book-id">${xmlText(identifierUrn(meta.identifier))}</dc:identifier>`,
    `<dc:title id="title">${xmlText(meta.title)}</dc:title>`,
    `<meta refines="#title" property="title-type">main</meta>`,
    ...(meta.subtitle?.trim()
      ? [
          `<dc:title id="subtitle">${xmlText(meta.subtitle)}</dc:title>`,
          `<meta refines="#subtitle" property="title-type">subtitle</meta>`,
        ]
      : []),
    `<dc:creator id="creator">${xmlText(meta.authorName)}</dc:creator>`,
    `<meta refines="#creator" property="role" scheme="marc:relators">aut</meta>`,
    `<dc:language>${xmlText(meta.language)}</dc:language>`,
    ...optionalElement("dc:publisher", meta.publisher),
    ...optionalElement("dc:description", meta.description),
    ...optionalElement("dc:rights", meta.rights),
    ...meta.subjects.flatMap((subject) =>
      optionalElement("dc:subject", subject),
    ),
    `<meta property="dcterms:modified">${formatModified(meta.modifiedAt)}</meta>`,
    ...(meta.seriesName?.trim()
      ? [
          `<meta property="belongs-to-collection" id="series">${xmlText(meta.seriesName)}</meta>`,
          `<meta refines="#series" property="collection-type">series</meta>`,
          ...(meta.seriesNumber !== null
            ? [
                `<meta refines="#series" property="group-position">${meta.seriesNumber}</meta>`,
              ]
            : []),
        ]
      : []),
    // EPUB 2 cover hint; Kindle conversion still reads it.
    ...(cover ? [`<meta name="cover" content="cover-image"/>`] : []),
  ];
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="styles/book.css" media-type="text/css"/>`,
    ...(cover
      ? [
          `<item id="cover-image" href="${cover.href}" media-type="${cover.mimeType}" properties="cover-image"/>`,
          `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
        ]
      : []),
    ...manuscript.sections.map(
      (section) =>
        `<item id="${manifestId(section)}" href="${sectionHref(section)}" media-type="application/xhtml+xml"/>`,
    ),
  ];
  const spine = [
    ...(cover ? [`<itemref idref="cover"/>`] : []),
    ...manuscript.sections.map(
      (section) => `<itemref idref="${manifestId(section)}"/>`,
    ),
  ];
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${xmlAttr(meta.language)}">`,
    `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">`,
    ...metadata.map((line) => `    ${line}`),
    `  </metadata>`,
    `  <manifest>`,
    ...manifest.map((line) => `    ${line}`),
    `  </manifest>`,
    `  <spine toc="ncx">`,
    ...spine.map((line) => `    ${line}`),
    `  </spine>`,
    `</package>`,
    ``,
  ].join("\n");
}

function optionalElement(name: string, value: string | null): string[] {
  return value?.trim() ? [`<${name}>${xmlText(value.trim())}</${name}>`] : [];
}

function xhtmlDocument(input: {
  meta: ExportBookMeta;
  title: string;
  cssHref: string;
  bodyType: string | null;
  body: string[];
}): string {
  const language = xmlAttr(input.meta.language);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE html>`,
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}">`,
    `<head>`,
    `  <meta charset="utf-8"/>`,
    `  <title>${xmlText(input.title)}</title>`,
    `  <link rel="stylesheet" type="text/css" href="${input.cssHref}"/>`,
    `</head>`,
    input.bodyType ? `<body epub:type="${input.bodyType}">` : `<body>`,
    ...input.body,
    `</body>`,
    `</html>`,
    ``,
  ].join("\n");
}

function sectionDocument(
  manuscript: ExportManuscript,
  section: ExportSection,
): string {
  const { meta } = manuscript;
  const type = sectionTypes[section.kind];
  const titlePage = section.kind === "title-page";
  const heading = section.showHeading && !titlePage;
  const attributes = [
    `id="${section.id}"`,
    `class="${section.kind}"`,
    ...(type ? [`epub:type="${type}"`] : []),
    // Without a visible heading, assistive technology still gets a name.
    ...(heading || titlePage ? [] : [`aria-label="${xmlAttr(section.title)}"`]),
  ];
  const content = titlePage
    ? titlePageHtml(meta)
    : section.kind === "toc"
      ? inlineTocHtml(manuscript, section)
      : blocksHtml(section.blocks);
  return xhtmlDocument({
    meta,
    title: titlePage ? meta.title : section.title,
    cssHref: "../styles/book.css",
    bodyType: roleTypes[section.role],
    body: [
      `<section ${attributes.join(" ")}>`,
      ...(heading ? [`<h1>${xmlText(section.title)}</h1>`] : []),
      ...content,
      `</section>`,
    ],
  });
}

function titlePageHtml(meta: ExportBookMeta): string[] {
  return [
    `<h1 class="book-title">${xmlText(meta.title)}</h1>`,
    ...(meta.subtitle?.trim()
      ? [`<p class="book-subtitle">${xmlText(meta.subtitle)}</p>`]
      : []),
    `<p class="book-author">${xmlText(meta.authorName)}</p>`,
    ...(meta.publisher?.trim()
      ? [`<p class="book-publisher">${xmlText(meta.publisher)}</p>`]
      : []),
  ];
}

/** The in-book HTML TOC: links only, no page numbers (KDP rule). */
function inlineTocHtml(
  manuscript: ExportManuscript,
  self: ExportSection,
): string[] {
  const entries = tocEntries(manuscript).filter(
    (section) => section.id !== self.id,
  );
  if (entries.length === 0) return [];
  return [
    `<ol class="toc-list">`,
    ...entries.map(
      (section) =>
        `  <li><a href="${section.id}.xhtml">${xmlText(section.title)}</a></li>`,
    ),
    `</ol>`,
  ];
}

function blocksHtml(blocks: ManuscriptBlock[]): string[] {
  const lines: string[] = [];
  // The first paragraph of a section or scene is set flush left.
  let first = true;
  for (const block of blocks) {
    if (block.type === "scene-break") {
      lines.push(`<p class="scene-break">* * *</p>`);
      first = true;
      continue;
    }
    lines.push(
      `<p${first ? ` class="first"` : ""}>${runsHtml(block.runs)}</p>`,
    );
    first = false;
  }
  return lines;
}

function runsHtml(runs: InlineRun[]): string {
  return runs
    .map((run) => {
      let html = run.text.split("\n").map(xmlText).join("<br/>");
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      return html;
    })
    .join("");
}

function coverDocument(meta: ExportBookMeta, cover: CoverFile): string {
  return xhtmlDocument({
    meta,
    title: labelsFor(meta.language).cover,
    cssHref: "styles/book.css",
    bodyType: null,
    body: [
      `<section class="cover" epub:type="cover">`,
      `<img src="${cover.href}" alt="${xmlAttr(meta.title)}"/>`,
      `</section>`,
    ],
  });
}

function navDocument(
  manuscript: ExportManuscript,
  cover: CoverFile | null,
): string {
  const { meta } = manuscript;
  const labels = labelsFor(meta.language);
  const inlineToc = manuscript.sections.find(
    (section) => section.kind === "toc",
  );
  const firstBody = manuscript.sections.find(
    (section) => section.role === "body",
  );
  const landmarks = [
    ...(cover
      ? [
          `<li><a epub:type="cover" href="cover.xhtml">${xmlText(labels.cover)}</a></li>`,
        ]
      : []),
    // The nav document is not in the spine, so only an in-book TOC can be a
    // landmark target.
    ...(inlineToc
      ? [
          `<li><a epub:type="toc" href="${sectionHref(inlineToc)}">${xmlText(inlineToc.title)}</a></li>`,
        ]
      : []),
    ...(firstBody
      ? [
          `<li><a epub:type="bodymatter" href="${sectionHref(firstBody)}">${xmlText(labels.beginReading)}</a></li>`,
        ]
      : []),
  ];
  const tocTitle = inlineToc?.title ?? labels.contents;
  return xhtmlDocument({
    meta,
    title: tocTitle,
    cssHref: "styles/book.css",
    bodyType: null,
    body: [
      `<nav epub:type="toc" id="toc">`,
      `<h1>${xmlText(tocTitle)}</h1>`,
      `<ol>`,
      ...tocEntries(manuscript).map(
        (section) =>
          `  <li><a href="${sectionHref(section)}">${xmlText(section.title)}</a></li>`,
      ),
      `</ol>`,
      `</nav>`,
      ...(landmarks.length > 0
        ? [
            `<nav epub:type="landmarks" id="landmarks" hidden="hidden">`,
            `<h2>${xmlText(labels.landmarks)}</h2>`,
            `<ol>`,
            ...landmarks.map((line) => `  ${line}`),
            `</ol>`,
            `</nav>`,
          ]
        : []),
    ],
  });
}

/** EPUB 2 navigation; older Kindle conversion paths still read it. */
function ncxDocument(manuscript: ExportManuscript): string {
  const { meta } = manuscript;
  const navPoints = tocEntries(manuscript).flatMap((section, index) => [
    `    <navPoint id="navpoint-${index + 1}" playOrder="${index + 1}">`,
    `      <navLabel><text>${xmlText(section.title)}</text></navLabel>`,
    `      <content src="${sectionHref(section)}"/>`,
    `    </navPoint>`,
  ]);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${xmlAttr(meta.language)}">`,
    `  <head>`,
    `    <meta name="dtb:uid" content="${xmlAttr(identifierUrn(meta.identifier))}"/>`,
    `    <meta name="dtb:depth" content="1"/>`,
    `    <meta name="dtb:totalPageCount" content="0"/>`,
    `    <meta name="dtb:maxPageNumber" content="0"/>`,
    `  </head>`,
    `  <docTitle><text>${xmlText(meta.title)}</text></docTitle>`,
    `  <docAuthor><text>${xmlText(meta.authorName)}</text></docAuthor>`,
    `  <navMap>`,
    ...navPoints,
    `  </navMap>`,
    `</ncx>`,
    ``,
  ].join("\n");
}
