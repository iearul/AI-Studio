import { describe, expect, it } from "vitest";

import { buildEpub, readZip, validateEpubStructure } from "../src/index.js";
import { sampleManuscript, tinyPng } from "./fixtures.js";

const decoder = new TextDecoder();

function epubFiles(bytes: Uint8Array): Map<string, string> {
  return new Map(
    [...readZip(bytes)].map(([path, data]) => [path, decoder.decode(data)]),
  );
}

function file(files: Map<string, string>, path: string): string {
  const content = files.get(path);
  if (content === undefined) throw new Error(`${path} is missing`);
  return content;
}

describe("buildEpub", () => {
  it("passes the structural validator without errors or warnings", () => {
    const report = validateEpubStructure(buildEpub(sampleManuscript()));
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.stats).toMatchObject({ xhtmlFiles: 11, tocEntries: 6 });
  });

  it("stores the mimetype first and uncompressed", () => {
    const bytes = buildEpub(sampleManuscript());
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
    expect(decoder.decode(bytes.subarray(30, 38))).toBe("mimetype");
    expect(decoder.decode(bytes.subarray(38, 58))).toBe("application/epub+zip");
    expect([...readZip(bytes).keys()].slice(0, 3)).toEqual([
      "mimetype",
      "META-INF/container.xml",
      "OEBPS/content.opf",
    ]);
  });

  it("is byte-for-byte reproducible", () => {
    expect(buildEpub(sampleManuscript())).toEqual(
      buildEpub(sampleManuscript()),
    );
  });

  it("writes the package metadata", () => {
    const opf = file(
      epubFiles(buildEpub(sampleManuscript())),
      "OEBPS/content.opf",
    );
    expect(opf).toContain('unique-identifier="book-id"');
    expect(opf).toContain(
      '<dc:identifier id="book-id">urn:uuid:6f1c1f0e-8a5b-4b8e-9a43-0d2f1f7f6c11</dc:identifier>',
    );
    expect(opf).toContain('<dc:title id="title">Salt &amp; Shadows</dc:title>');
    expect(opf).toContain(
      '<dc:title id="subtitle">A "Harbour" Mystery &lt;Book Two&gt;</dc:title>',
    );
    expect(opf).toContain(
      '<dc:creator id="creator">V. K. Rabenhorst</dc:creator>',
    );
    expect(opf).toContain("<dc:language>en</dc:language>");
    expect(opf).toContain(
      "<dc:publisher>Rabenhorst &amp; Söhne</dc:publisher>",
    );
    expect(opf).toContain(
      "<dc:subject>Fiction / Mystery &amp; Detective</dc:subject>",
    );
    expect(opf).toContain(
      '<meta property="dcterms:modified">2026-10-29T09:15:30Z</meta>',
    );
    expect(opf).toContain(
      '<meta property="belongs-to-collection" id="series">The Harbour Cycle</meta>',
    );
    expect(opf).toContain(
      '<meta refines="#series" property="group-position">2</meta>',
    );
    expect(opf).toContain('<spine toc="ncx">');
    expect(opf).not.toContain("cover-image");
  });

  it("links every TOC section from the nav, the NCX and the in-book TOC", () => {
    const manuscript = sampleManuscript();
    const files = epubFiles(buildEpub(manuscript));
    const navDocument = file(files, "OEBPS/nav.xhtml");
    const nav =
      /<nav epub:type="toc"[\s\S]*?<\/nav>/.exec(navDocument)?.[0] ?? "";
    const ncx = file(files, "OEBPS/toc.ncx");
    const inlineToc = file(files, "OEBPS/text/contents.xhtml");
    expect(nav).toContain('<nav epub:type="toc" id="toc">');
    expect(navDocument).toContain('<nav epub:type="landmarks"');
    expect(navDocument).toContain(
      '<a epub:type="bodymatter" href="text/chapter-1.xhtml">',
    );
    for (const section of manuscript.sections) {
      const listed = section.includeInToc;
      expect(nav.includes(`href="text/${section.id}.xhtml">`)).toBe(listed);
      expect(ncx.includes(`<content src="text/${section.id}.xhtml"/>`)).toBe(
        listed,
      );
      expect(inlineToc.includes(`href="${section.id}.xhtml"`)).toBe(listed);
    }
    for (const id of ["chapter-1", "chapter-2", "chapter-3"]) {
      expect(nav).toContain(`href="text/${id}.xhtml"`);
    }
    expect(nav).toContain("Chapter 2: Salt &amp; Smoke");
  });

  it("renders chapters as escaped, semantic XHTML", () => {
    const files = epubFiles(buildEpub(sampleManuscript()));
    const chapter1 = file(files, "OEBPS/text/chapter-1.xhtml");
    const chapter2 = file(files, "OEBPS/text/chapter-2.xhtml");
    expect(chapter1).toContain(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">',
    );
    expect(chapter1).toContain("<title>Chapter 1: The Night Ferry</title>");
    expect(chapter1).toContain('<body epub:type="bodymatter">');
    expect(chapter1).toContain('epub:type="chapter"');
    expect(chapter1).toContain("<h1>Chapter 1: The Night Ferry</h1>");
    expect(chapter1).toContain(
      '<p class="first">The ferry left at midnight, and Herr Müller was <em>not</em> on it.</p>',
    );
    expect(chapter1).toContain(
      `<p>"Tom &amp; Jerry's &lt;boat&gt; isn't 'here'," said the harbour master.</p>`,
    );
    expect(chapter1).toContain("read:<br/>NO PASSENGERS AFTER DARK");
    expect(chapter2).toContain("<strong>Stop!</strong>");
    expect(chapter2).toContain(
      '<p class="scene-break">* * *</p>\n<p class="first">By morning the <em>Möwe</em>',
    );
    expect(chapter2).toContain("<title>Chapter 2: Salt &amp; Smoke</title>");
  });

  it("marks front and back matter with their semantics", () => {
    const files = epubFiles(buildEpub(sampleManuscript()));
    const titlePage = file(files, "OEBPS/text/title-page.xhtml");
    expect(titlePage).toContain('<body epub:type="frontmatter">');
    expect(titlePage).toContain('epub:type="titlepage"');
    expect(titlePage).toContain(
      '<h1 class="book-title">Salt &amp; Shadows</h1>',
    );
    expect(titlePage).toContain(
      '<p class="book-subtitle">A "Harbour" Mystery &lt;Book Two&gt;</p>',
    );
    expect(titlePage).toContain('<p class="book-author">V. K. Rabenhorst</p>');
    expect(file(files, "OEBPS/text/copyright.xhtml")).toContain(
      'epub:type="copyright-page"',
    );
    expect(file(files, "OEBPS/text/dedication.xhtml")).toContain(
      'epub:type="dedication"',
    );
    expect(file(files, "OEBPS/text/contents.xhtml")).toContain(
      'epub:type="toc"',
    );
    expect(file(files, "OEBPS/text/epilogue.xhtml")).toContain(
      'epub:type="epilogue"',
    );
    expect(file(files, "OEBPS/text/about-the-author.xhtml")).toContain(
      '<body epub:type="backmatter">',
    );
  });

  it("ships a Kindle-safe stylesheet", () => {
    const css = file(
      epubFiles(buildEpub(sampleManuscript())),
      "OEBPS/styles/book.css",
    );
    expect(css).not.toMatch(/\d+px/);
    expect(css).not.toMatch(/position\s*:/);
    expect(css).toMatch(/p\s*\{[^}]*text-indent: 1\.5em/);
    expect(css).toMatch(/p\.first\s*\{[^}]*text-indent: 0/);
    expect(css).toMatch(/p\.scene-break\s*\{[^}]*text-align: center/);
    expect(css).toContain("page-break-before: always");
    expect(css).toContain("break-before: page");
  });

  it("embeds a cover only when asked", () => {
    const bytes = buildEpub(sampleManuscript(), {
      cover: { bytes: tinyPng(), mimeType: "image/png" },
    });
    const files = epubFiles(bytes);
    const opf = file(files, "OEBPS/content.opf");
    expect(opf).toContain(
      '<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>',
    );
    expect(opf).toMatch(/<spine toc="ncx">\s*<itemref idref="cover"\/>/);
    expect(file(files, "OEBPS/cover.xhtml")).toContain(
      '<img src="images/cover.png" alt="Salt &amp; Shadows"/>',
    );
    expect(file(files, "OEBPS/nav.xhtml")).toContain(
      '<a epub:type="cover" href="cover.xhtml">',
    );
    expect(validateEpubStructure(bytes).errors).toEqual([]);
    expect(
      epubFiles(buildEpub(sampleManuscript())).has("OEBPS/cover.xhtml"),
    ).toBe(false);
  });

  it("rejects section ids that cannot be file names", () => {
    const manuscript = sampleManuscript();
    manuscript.sections[4]!.id = "Chapter 1";
    expect(() => buildEpub(manuscript)).toThrow(/a-z, 0-9/);
    manuscript.sections[4]!.id = "chapter-2";
    expect(() => buildEpub(manuscript)).toThrow(/used twice/);
  });
});
