import { describe, expect, it } from "vitest";

import {
  lengthWarnings,
  needsExpansion,
  planChapterWords,
  presetForWords,
  shouldDraftByScene,
  suggestChapterCount,
} from "../src/index.js";

describe("chapter planner", () => {
  it("splits 24,000 words over 12 chapters around 2,000 each, summing exactly", () => {
    const plan = planChapterWords(24_000, 12, "balanced");
    expect(plan).toHaveLength(12);
    expect(plan.reduce((sum, value) => sum + value, 0)).toBe(24_000);
    for (const words of plan) {
      expect(words).toBeGreaterThan(1_500);
      expect(words).toBeLessThan(2_600);
    }
    expect(new Set(plan).size).toBeGreaterThan(4);
  });

  it("shortens chapters toward the climax for fast pacing", () => {
    const plan = planChapterWords(40_000, 20, "fast");
    const firstHalf = plan.slice(1, 10).reduce((sum, value) => sum + value, 0);
    const secondHalf = plan
      .slice(10, 19)
      .reduce((sum, value) => sum + value, 0);
    expect(secondHalf).toBeLessThan(firstHalf);
    expect(plan.reduce((sum, value) => sum + value, 0)).toBe(40_000);
  });

  it("weights chapters with more scenes", () => {
    const plan = planChapterWords(10_000, 4, "balanced", [1, 4, 4, 1]);
    expect(plan[1]!).toBeGreaterThan(plan[0]!);
    expect(plan.reduce((sum, value) => sum + value, 0)).toBe(10_000);
  });

  it("handles single-chapter flash fiction", () => {
    expect(planChapterWords(1_000, 1, "balanced")).toEqual([1_000]);
    expect(suggestChapterCount(1_000, "balanced")).toBe(1);
  });

  it("suggests about twelve chapters for a 24,000-word thriller", () => {
    const count = suggestChapterCount(
      24_000,
      "balanced",
      "Psychological thriller",
    );
    expect(count).toBeGreaterThanOrEqual(11);
    expect(count).toBeLessThanOrEqual(14);
    expect(presetForWords(24_000).id).toBe("novella");
  });

  it("drafts long chapters scene by scene and expands short drafts", () => {
    expect(shouldDraftByScene(3_500, 3)).toBe(true);
    expect(shouldDraftByScene(2_000, 3)).toBe(false);
    expect(needsExpansion(1_400, 2_000)).toBe(true);
    expect(needsExpansion(1_600, 2_000)).toBe(false);
  });

  it("warns when a genre and length do not match reader expectations", () => {
    const warnings = lengthWarnings("Psychological thriller", 20_000, 10);
    expect(warnings[0]?.message).toMatch(/novella/);
    expect(lengthWarnings("Psychological thriller", 80_000, 30)).toEqual([]);
    expect(lengthWarnings("Romance", 60_000, 120)[0]?.message).toMatch(
      /fewer chapters/,
    );
  });
});
