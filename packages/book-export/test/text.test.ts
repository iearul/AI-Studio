import { describe, expect, it } from "vitest";

import { buildMarkdown, buildPlainText } from "../src/index.js";
import { sampleManuscript } from "./fixtures.js";

describe("buildMarkdown", () => {
  const markdown = buildMarkdown(sampleManuscript());

  it("starts with a front matter header", () => {
    expect(markdown.startsWith('---\ntitle: "Salt & Shadows"\n')).toBe(true);
    expect(markdown).toContain(
      'subtitle: "A \\"Harbour\\" Mystery <Book Two>"',
    );
    expect(markdown).toContain('author: "V. K. Rabenhorst"');
    expect(markdown).toContain('language: "en"');
    expect(markdown).toContain(
      'identifier: "urn:uuid:6f1c1f0e-8a5b-4b8e-9a43-0d2f1f7f6c11"',
    );
    expect(markdown).toContain('series: "The Harbour Cycle"\nseries_number: 2');
    expect(markdown).toContain(
      'subjects: ["Fiction / Mystery & Detective", "Ferries"]',
    );
    expect(markdown).toMatch(
      /\n---\n\n# Salt & Shadows\n\n\*A "Harbour" Mystery \\<Book Two\\>\*\n\nV\. K\. Rabenhorst\n/,
    );
  });

  it("writes headings, emphasis, hard breaks and scene breaks", () => {
    expect(markdown).toContain(
      "## Contents\n\n- Chapter 1: The Night Ferry\n- Chapter 2: Salt & Smoke\n",
    );
    expect(markdown).toContain(
      "## Chapter 1: The Night Ferry\n\nThe ferry left at midnight, and Herr Müller was *not* on it.",
    );
    expect(markdown).toContain(
      `"Tom & Jerry's \\<boat\\> isn't 'here'," said the harbour master.`,
    );
    expect(markdown).toContain("read:\\\nNO PASSENGERS AFTER DARK");
    expect(markdown).toContain(
      "**Stop!** someone shouted.\n\nNobody stopped.\n\n* * *\n\nBy morning the *Möwe*",
    );
    expect(markdown).toContain("*For Anna Müller, who kept the lamp lit.*");
    expect(markdown).not.toContain("## Copyright");
    expect(markdown.endsWith("*The light went out at 3:12 a.m.*\n")).toBe(true);
  });

  it("escapes text that Markdown would read as markup", () => {
    const manuscript = sampleManuscript();
    manuscript.sections[6]!.blocks = [
      {
        type: "paragraph",
        runs: [
          {
            text: "# not a heading, 2*3 and snake_case",
            italic: false,
            bold: false,
          },
        ],
      },
      {
        type: "paragraph",
        runs: [{ text: "1. not a list", italic: false, bold: false }],
      },
    ];
    const output = buildMarkdown(manuscript);
    expect(output).toContain("\\# not a heading, 2\\*3 and snake\\_case");
    expect(output).toContain("1\\. not a list");
  });
});

describe("buildPlainText", () => {
  it("writes the book without markup", () => {
    const text = buildPlainText(sampleManuscript());
    expect(
      text.startsWith(
        'Salt & Shadows\nA "Harbour" Mystery <Book Two>\n\nV. K. Rabenhorst\n',
      ),
    ).toBe(true);
    expect(text).toContain(
      "Chapter 1: The Night Ferry\n\nThe ferry left at midnight, and Herr Müller was not on it.",
    );
    expect(text).toContain(
      `"Tom & Jerry's <boat> isn't 'here'," said the harbour master.`,
    );
    expect(text).toContain("read:\nNO PASSENGERS AFTER DARK");
    expect(text).toContain("Nobody stopped.\n\n* * *\n\nBy morning the Möwe");
    expect(text).not.toMatch(/\*not\*|\*\*Stop/);
  });
});
