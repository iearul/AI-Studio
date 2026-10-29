import { describe, expect, it } from "vitest";

import {
  countManuscriptWords,
  countWords,
  manuscriptToRichText,
  normalizeManuscript,
  parseManuscript,
  plainTextToManuscript,
  richTextToManuscript,
  serializeManuscript,
} from "../src/markup.js";

describe("manuscript markup", () => {
  it("parses paragraphs, emphasis, hard breaks and scene breaks", () => {
    const blocks = parseManuscript(
      "She read the *last* line.\n\n* * *\n\n**Bold** and ***both***.\nNext line \\*not italic\\*",
    );
    expect(blocks).toEqual([
      {
        type: "paragraph",
        runs: [
          { text: "She read the ", italic: false, bold: false },
          { text: "last", italic: true, bold: false },
          { text: " line.", italic: false, bold: false },
        ],
      },
      { type: "scene-break" },
      {
        type: "paragraph",
        runs: [
          { text: "Bold", italic: false, bold: true },
          { text: " and ", italic: false, bold: false },
          { text: "both", italic: true, bold: true },
          { text: ".\nNext line *not italic*", italic: false, bold: false },
        ],
      },
    ]);
  });

  it("keeps unpaired markers literal", () => {
    expect(parseManuscript("5 * 3 = 15")).toEqual([
      {
        type: "paragraph",
        runs: [{ text: "5 * 3 = 15", italic: false, bold: false }],
      },
    ]);
  });

  it("round-trips through serialization and rich text", () => {
    const markup =
      "He said *no*, then **left**.\nShe stayed.\n\n* * *\n\nAn asterisk: \\* and a ***storm***.";
    expect(normalizeManuscript(markup)).toBe(markup);
    expect(richTextToManuscript(manuscriptToRichText(markup))).toBe(markup);
    expect(serializeManuscript(parseManuscript(markup))).toBe(markup);
  });

  it("does not turn a literal hash paragraph into a scene break", () => {
    const markup = serializeManuscript([
      { type: "paragraph", runs: [{ text: "#", italic: false, bold: false }] },
    ]);
    expect(parseManuscript(markup)[0]?.type).toBe("paragraph");
  });

  it("counts words like a word processor", () => {
    expect(countWords("It's a well-known fact — 42 times.")).toBe(6);
    expect(countManuscriptWords("*One* two.\n\n* * *\n\nThree")).toBe(3);
  });

  it("escapes model output that is plain text", () => {
    expect(plainTextToManuscript("A *star*.\n\n***\n\nB")).toBe(
      "A \\*star\\*.\n\n* * *\n\nB",
    );
  });
});
