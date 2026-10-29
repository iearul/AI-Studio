import { describe, expect, it } from "vitest";

import {
  buildEpub,
  buildZip,
  readZip,
  validateEpubStructure,
} from "../src/index.js";
import type { EpubStructureReport } from "../src/index.js";
import { sampleManuscript } from "./fixtures.js";

const decoder = new TextDecoder();

/** Rebuilds the sample EPUB after editing its files as text. */
function tampered(
  edit: (files: Map<string, string | Uint8Array>) => void,
  options: { compressMimetype?: boolean } = {},
): Uint8Array {
  const files = new Map<string, string | Uint8Array>(
    [...readZip(buildEpub(sampleManuscript()))].map(([path, data]) => [
      path,
      /\.(?:xhtml|opf|ncx|css|xml)$|^mimetype$/.test(path)
        ? decoder.decode(data)
        : data,
    ]),
  );
  edit(files);
  return buildZip(
    [...files].map(([path, data]) => ({
      path,
      data,
      store: path === "mimetype" && !options.compressMimetype,
    })),
  );
}

function edited(
  files: Map<string, string | Uint8Array>,
  path: string,
  change: (text: string) => string,
): void {
  const content = files.get(path);
  if (typeof content !== "string") throw new Error(`${path} is not text`);
  files.set(path, change(content));
}

function codes(issues: EpubStructureReport["errors"]): string[] {
  return issues.map((issue) => issue.code);
}

describe("validateEpubStructure", () => {
  it("rejects bytes that are not a ZIP archive", () => {
    const report = validateEpubStructure(new TextEncoder().encode("not a zip"));
    expect(report.ok).toBe(false);
    expect(codes(report.errors)).toEqual(["ZIP_INVALID"]);
  });

  it("reports a removed content file in the manifest and in links", () => {
    const report = validateEpubStructure(
      tampered((files) => files.delete("OEBPS/text/chapter-2.xhtml")),
    );
    expect(report.ok).toBe(false);
    expect(report.errors).toContainEqual(
      expect.objectContaining({
        code: "MANIFEST_FILE_MISSING",
        path: "OEBPS/content.opf",
      }),
    );
    expect(report.errors).toContainEqual(
      expect.objectContaining({ code: "LINK_BROKEN", path: "OEBPS/nav.xhtml" }),
    );
    expect(report.errors).toContainEqual(
      expect.objectContaining({ code: "LINK_BROKEN", path: "OEBPS/toc.ncx" }),
    );
  });

  it("reports broken links and missing fragments", () => {
    const report = validateEpubStructure(
      tampered((files) => {
        edited(files, "OEBPS/nav.xhtml", (text) =>
          text.replace("text/chapter-3.xhtml", "text/chapter-9.xhtml"),
        );
        edited(files, "OEBPS/text/contents.xhtml", (text) =>
          text.replace(
            'href="chapter-1.xhtml"',
            'href="chapter-1.xhtml#nowhere"',
          ),
        );
      }),
    );
    expect(report.errors).toEqual([
      expect.objectContaining({ code: "LINK_BROKEN", path: "OEBPS/nav.xhtml" }),
      expect.objectContaining({
        code: "LINK_FRAGMENT_MISSING",
        path: "OEBPS/text/contents.xhtml",
      }),
    ]);
  });

  it("accepts fragments that point to existing ids", () => {
    const report = validateEpubStructure(
      tampered((files) =>
        edited(files, "OEBPS/text/contents.xhtml", (text) =>
          text.replace(
            'href="chapter-1.xhtml"',
            'href="chapter-1.xhtml#chapter-1"',
          ),
        ),
      ),
    );
    expect(report.errors).toEqual([]);
  });

  it("reports malformed XHTML", () => {
    const report = validateEpubStructure(
      tampered((files) =>
        edited(files, "OEBPS/text/chapter-1.xhtml", (text) =>
          text.replace("</p>", ""),
        ),
      ),
    );
    expect(report.errors).toEqual([
      expect.objectContaining({
        code: "XML_MALFORMED",
        path: "OEBPS/text/chapter-1.xhtml",
      }),
    ]);
  });

  it("reports a compressed mimetype", () => {
    const report = validateEpubStructure(
      tampered(() => {}, { compressMimetype: true }),
    );
    expect(codes(report.errors)).toEqual(["MIMETYPE_COMPRESSED"]);
  });

  it("reports a mimetype that is not the first entry", () => {
    const report = validateEpubStructure(
      tampered((files) => {
        const mimetype = files.get("mimetype") ?? "";
        files.delete("mimetype");
        files.set("mimetype", mimetype);
      }),
    );
    expect(codes(report.errors)).toEqual(["MIMETYPE_NOT_FIRST"]);
  });

  it("reports wrong mimetype content and a missing container", () => {
    const report = validateEpubStructure(
      tampered((files) => {
        files.set("mimetype", "application/zip");
        files.delete("META-INF/container.xml");
      }),
    );
    expect(codes(report.errors)).toEqual([
      "MIMETYPE_CONTENT",
      "CONTAINER_MISSING",
    ]);
  });

  it("reports missing package metadata", () => {
    const report = validateEpubStructure(
      tampered((files) =>
        edited(files, "OEBPS/content.opf", (text) =>
          text
            .replace(/<dc:language>.*<\/dc:language>/, "")
            .replace("2026-10-29T09:15:30Z", "2026-10-29T09:15:30.123Z")
            .replace(
              'unique-identifier="book-id"',
              'unique-identifier="other"',
            ),
        ),
      ),
    );
    expect(codes(report.errors)).toEqual([
      "OPF_MISSING_LANGUAGE",
      "OPF_UNIQUE_IDENTIFIER",
      "OPF_MODIFIED_FORMAT",
    ]);
  });

  it("reports spine and nav problems", () => {
    const report = validateEpubStructure(
      tampered((files) =>
        edited(files, "OEBPS/content.opf", (text) =>
          text
            .replace(
              '<itemref idref="sec-epilogue"/>',
              '<itemref idref="sec-missing"/>',
            )
            .replace(
              'media-type="text/css"/>',
              'media-type="text/css" properties="nav"/>',
            ),
        ),
      ),
    );
    expect(codes(report.errors)).toEqual([
      "SPINE_IDREF_UNKNOWN",
      "NAV_MULTIPLE",
    ]);
  });

  it("reports scripts, forms and fixed layout as errors", () => {
    const report = validateEpubStructure(
      tampered((files) => {
        edited(files, "OEBPS/text/chapter-3.xhtml", (text) =>
          text.replace(
            "</section>",
            '<form action="x"><input type="text" name="q"/></form><script>alert(1)</script></section>',
          ),
        );
        edited(files, "OEBPS/content.opf", (text) =>
          text.replace(
            "</metadata>",
            '<meta property="rendition:layout">pre-paginated</meta></metadata>',
          ),
        );
      }),
    );
    expect(codes(report.errors).sort()).toEqual([
      "FIXED_LAYOUT",
      "FORM_FOUND",
      "FORM_FOUND",
      "SCRIPT_FOUND",
    ]);
  });

  it("warns about Kindle compatibility problems", () => {
    const report = validateEpubStructure(
      tampered((files) => {
        edited(
          files,
          "OEBPS/styles/book.css",
          (text) => `${text}\n.x { position: absolute; margin-left: -2em; }\n`,
        );
        edited(files, "OEBPS/nav.xhtml", (text) =>
          text.replace(
            "Chapter 3: Low Tide<",
            "Chapter 3: Low Tide ........ 27<",
          ),
        );
        edited(files, "OEBPS/text/epilogue.xhtml", (text) =>
          text.replace(
            "</section>",
            '<p><img src="../images/map.png"/></p></section>',
          ),
        );
        files.set("OEBPS/images/map.png", new Uint8Array([1, 2, 3]));
        files.set("OEBPS/fonts/serif.otf", new Uint8Array([1, 2, 3]));
        edited(files, "OEBPS/content.opf", (text) =>
          text.replace(
            "</manifest>",
            '<item id="map" href="images/map.png" media-type="image/png"/><item id="font" href="fonts/serif.otf" media-type="font/otf"/></manifest>',
          ),
        );
      }),
    );
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(codes(report.warnings).sort()).toEqual([
      "CSS_NEGATIVE_MARGIN",
      "CSS_POSITIONING",
      "FONT_EMBEDDED",
      "IMAGE_ALT_MISSING",
      "TOC_PAGE_NUMBERS",
    ]);
  });

  it("does not mistake chapter numbers for page numbers", () => {
    const report = validateEpubStructure(
      tampered((files) =>
        edited(files, "OEBPS/nav.xhtml", (text) =>
          text.replace("Epilogue<", "Chapter 12<"),
        ),
      ),
    );
    expect(report.warnings).toEqual([]);
  });

  it("warns about files missing from the manifest", () => {
    const report = validateEpubStructure(
      tampered((files) => files.set("OEBPS/notes.txt", "draft")),
    );
    expect(report.warnings).toEqual([
      expect.objectContaining({
        code: "FILE_NOT_IN_MANIFEST",
        path: "OEBPS/notes.txt",
      }),
    ]);
  });
});
