import { describe, expect, it } from "vitest";

import { buildDocx, readZip } from "../src/index.js";
import { sampleManuscript } from "./fixtures.js";

const decoder = new TextDecoder();

async function docxParts(): Promise<Map<string, string>> {
  const files = readZip(await buildDocx(sampleManuscript()));
  return new Map(
    [...files].map(([path, data]) => [path, decoder.decode(data)]),
  );
}

function part(parts: Map<string, string>, path: string): string {
  const content = parts.get(path);
  if (content === undefined) throw new Error(`${path} is missing`);
  return content;
}

function count(text: string, pattern: string): number {
  return text.split(pattern).length - 1;
}

describe("buildDocx", () => {
  it("writes chapter headings as Heading1 with a page break before every section", async () => {
    const manuscript = sampleManuscript();
    const document = part(await docxParts(), "word/document.xml");
    const shownHeadings = manuscript.sections.filter(
      (section) => section.showHeading && section.kind !== "title-page",
    );
    expect(count(document, '<w:pStyle w:val="Heading1"/>')).toBe(
      shownHeadings.length,
    );
    expect(count(document, '<w:pStyle w:val="Title"/>')).toBe(1);
    expect(count(document, "<w:pageBreakBefore/>")).toBe(
      manuscript.sections.length - 1,
    );
    expect(document).toContain("Chapter 1: The Night Ferry");
  });

  it("links the table of contents to bookmarks", async () => {
    const document = part(await docxParts(), "word/document.xml");
    const anchors = [
      ...document.matchAll(/<w:hyperlink [^>]*w:anchor="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(anchors).toHaveLength(6);
    for (const anchor of anchors) {
      expect(document).toContain(`<w:bookmarkStart w:name="${anchor}"`);
    }
    expect(anchors).toContain("s5_chapter_1");
    // A TOC field would need Word to update it before the links exist.
    expect(document).not.toContain("w:instrText");
    expect(document).not.toContain("w:fldChar");
  });

  it("keeps emphasis, hard breaks and scene breaks as real formatting", async () => {
    const document = part(await docxParts(), "word/document.xml");
    expect(document).toMatch(
      /<w:rPr><w:i\/>(?:<w:iCs\/>)?<\/w:rPr><w:t xml:space="preserve">not<\/w:t>/,
    );
    expect(document).toMatch(
      /<w:b\/>(?:<w:bCs\/>)?<\/w:rPr><w:t xml:space="preserve">Stop!<\/w:t>/,
    );
    expect(count(document, "<w:br/>")).toBe(1);
    expect(document).toContain(
      '<w:r><w:t xml:space="preserve">The sign by the gangway read:</w:t></w:r><w:r><w:br/><w:t xml:space="preserve">NO PASSENGERS AFTER DARK</w:t></w:r>',
    );
    expect(document).toMatch(
      /<w:pStyle w:val="SceneBreak"\/><\/w:pPr><w:r><w:t xml:space="preserve">\* \* \*<\/w:t>/,
    );
    expect(document).toContain("Müller");
    expect(document).toContain("&lt;boat&gt;");
    expect(document).toContain("Tom &amp; Jerry");
  });

  it("uses a flush first paragraph and an indented Normal style", async () => {
    const parts = await docxParts();
    const document = part(parts, "word/document.xml");
    const styles = part(parts, "word/styles.xml");
    expect(document).toContain('<w:pStyle w:val="FirstParagraph"/>');
    expect(styles).toMatch(
      /<w:style w:type="paragraph" w:styleId="Normal"[^>]*>.*?<w:ind w:firstLine="432"\/>.*?<\/w:style>/,
    );
    expect(styles).toMatch(
      /<w:style w:type="paragraph" w:styleId="FirstParagraph">.*?<w:ind w:firstLine="0"\/>.*?<\/w:style>/,
    );
    expect(styles).toContain('w:styleId="Heading1"');
    expect(styles).toContain('<w:lang w:val="en"/>');
  });

  it("contains no tracked changes or comments", async () => {
    const parts = await docxParts();
    const document = part(parts, "word/document.xml");
    for (const marker of [
      "<w:ins",
      "<w:del",
      "<w:commentRangeStart",
      "<w:commentReference",
    ]) {
      expect(document).not.toContain(marker);
    }
    expect(part(parts, "word/settings.xml")).not.toContain("trackRevisions");
    expect(parts.has("word/comments.xml")).toBe(false);
  });

  it("sets the document properties", async () => {
    const parts = await docxParts();
    const core = part(parts, "docProps/core.xml");
    expect(core).toContain("<dc:title>Salt &amp; Shadows</dc:title>");
    expect(core).toContain("<dc:creator>V. K. Rabenhorst</dc:creator>");
    expect(core).toContain("<dc:language>en</dc:language>");
    expect(core).toMatch(
      /<dcterms:modified[^>]*>2026-10-29T09:15:30Z<\/dcterms:modified>/,
    );
    expect([...parts.keys()][0]).toBe("[Content_Types].xml");
  });

  it("is byte-for-byte reproducible", async () => {
    const first = await buildDocx(sampleManuscript());
    const second = await buildDocx(sampleManuscript());
    expect(first).toEqual(second);
  });
});
