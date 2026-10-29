import { describe, expect, it } from "vitest";

import {
  detectTextProvenance,
  disclosureChecklist,
  lintManuscript,
  packContext,
} from "../src/index.js";

const filler = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      `Mara counted ${index} jars on the shelf before the kettle sang.`,
  ).join(" ");

describe("style lint", () => {
  it("flags dashes, clichés, stock phrases and repeated endings", () => {
    const chapter = (number: number) => ({
      number,
      content: `${filler(30)} Her heart pounded — loudly — again — and again — and again — and again. Her heart pounded once more. Little did she know what waited.\n\nShe ran.`,
    });
    const findings = lintManuscript([1, 2, 3, 4].map(chapter));
    const issues = findings.map((item) => item.issue).join("\n");
    expect(issues).toMatch(/Em dashes/);
    expect(issues).toMatch(/pounding heart/);
    expect(issues).toMatch(/little did she know/i);
    expect(issues).toMatch(/Chapters end the same way/);
    expect(issues).toMatch(/Chapters open with the same words/);
  });

  it("stays quiet on short or clean text", () => {
    expect(lintManuscript([{ number: 1, content: "Short." }])).toEqual([]);
  });
});

describe("provenance", () => {
  it("keeps AI-drafted text classified as AI-generated after human edits", () => {
    const result = detectTextProvenance([
      {
        chapterNumber: 1,
        hasText: true,
        revisionSources: ["ai-draft", "user-edit", "user-edit"],
      },
      { chapterNumber: 2, hasText: true, revisionSources: ["user-edit"] },
    ]);
    expect(result.classification).toBe("ai-generated");
  });

  it("separates AI-assisted from human text", () => {
    expect(
      detectTextProvenance([
        {
          chapterNumber: 1,
          hasText: true,
          revisionSources: ["user-edit", "ai-edit"],
        },
      ]).classification,
    ).toBe("ai-assisted");
    expect(
      detectTextProvenance([
        { chapterNumber: 1, hasText: true, revisionSources: ["user-edit"] },
      ]).classification,
    ).toBe("human");
  });

  it("recommends disclosure only for AI-generated assets", () => {
    const answers = disclosureChecklist([
      {
        asset: "text",
        classification: "ai-generated",
        detected: "ai-generated",
        detectedReason: "",
        overridden: false,
        notes: null,
        updatedAt: "",
      },
      {
        asset: "cover",
        classification: "ai-assisted",
        detected: "ai-assisted",
        detectedReason: "",
        overridden: false,
        notes: null,
        updatedAt: "",
      },
    ]);
    expect(answers.find((item) => item.asset === "text")?.mustDisclose).toBe(
      true,
    );
    expect(answers.find((item) => item.asset === "cover")?.mustDisclose).toBe(
      false,
    );
    expect(
      answers.find((item) => item.asset === "translation")?.classification,
    ).toBe("unknown");
  });
});

describe("context packing", () => {
  it("keeps priority sections, shortens running text and preserves order", () => {
    const packed = packContext(
      [
        {
          title: "Summaries",
          body: "x".repeat(4_000),
          priority: 3,
          truncatable: true,
        },
        { title: "Bible", body: "core rules", priority: 1 },
        { title: "Optional", body: "y".repeat(10_000), priority: 5 },
      ],
      800,
    );
    expect(packed.text.indexOf("Summaries")).toBeLessThan(
      packed.text.indexOf("Bible"),
    );
    expect(packed.text).toContain("(shortened)");
    expect(packed.droppedTitles).toEqual(["Optional"]);
    expect(packed.tokens).toBeLessThanOrEqual(800);
  });
});
