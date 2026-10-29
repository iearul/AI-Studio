import type { BookMetadata } from "@ai-film-studio/contracts";
import { describe, expect, it } from "vitest";

import {
  checkIdentityConsistency,
  checkMetadata,
  computeCostMicros,
  defaultKdpSettings,
  estimateRoyalty,
  validateCoverImage,
} from "../src/index.js";

const metadata: BookMetadata = {
  title: "The Glass Orchard",
  subtitle: null,
  seriesName: null,
  seriesNumber: null,
  edition: null,
  penName: "V. K. Rabenhorst",
  contributors: [],
  language: "en",
  description:
    "<p>A widow returns to the orchard where her husband vanished.</p><p><b>Some doors stay shut.</b></p>",
  keywords: [
    "psychological suspense",
    "small town secrets",
    "missing husband mystery",
    "unreliable narrator",
    "orchard family drama",
    "grief and guilt",
    "rural noir",
  ],
  categories: [
    { path: "Kindle eBooks › Thrillers › Psychological", rationale: "fits" },
  ],
  primaryMarketplace: "amazon.com",
  audience: "Adult",
  sexuallyExplicit: false,
  explicitContentAssessment: "None",
  minimumReaderAge: null,
  contentWarnings: [],
  publishingRights: "own-copyright",
  pricing: {
    currency: "USD",
    listPrice: 3.99,
    royaltyPlan: "70",
    rationale: "",
  },
  kdpSelect: { enroll: null, notes: "" },
  publication: { plan: "immediately", date: null, notes: "" },
  publisher: null,
  imprint: null,
  isbnNote: "",
  checklist: {},
};

describe("KDP cover validation", () => {
  it("accepts the ideal RGB JPEG", () => {
    const result = validateCoverImage(
      {
        mimeType: "image/jpeg",
        width: 1600,
        height: 2560,
        colorModel: "rgb",
        byteSize: 2_000_000,
      },
      "final",
    );
    expect(result).toMatchObject({ ok: true, errors: [], warnings: [] });
  });

  it("rejects CMYK, PNG finals, landscape and tiny covers", () => {
    const result = validateCoverImage(
      {
        mimeType: "image/png",
        width: 800,
        height: 600,
        colorModel: "cmyk",
        byteSize: 1_000,
      },
      "final",
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/JPEG or TIFF/);
    expect(result.errors.join(" ")).toMatch(/CMYK/);
    expect(result.errors.join(" ")).toMatch(/portrait/);
    expect(result.errors.join(" ")).toMatch(/minimum/);
  });

  it("warns about non-ideal sizes and ratio", () => {
    const result = validateCoverImage(
      {
        mimeType: "image/jpeg",
        width: 1000,
        height: 1400,
        colorModel: "rgb",
        byteSize: 500_000,
      },
      "final",
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBe(2);
  });
});

describe("metadata checks", () => {
  it("accepts a clean listing", () => {
    expect(
      checkMetadata(metadata).filter((item) => item.level === "error"),
    ).toEqual([]);
  });

  it("flags promotional terms, invented claims, bad tags and too many keywords", () => {
    const findings = checkMetadata({
      ...metadata,
      subtitle: "A Bestselling Thriller (Book 1)",
      description:
        '<div>Award-winning! ★★★★★ "Unputdownable" — Reader. Visit www.example.com</div>',
      keywords: [...metadata.keywords, "free kindle thriller"],
    });
    const messages = findings
      .map((item) => `${item.field}: ${item.message}`)
      .join("\n");
    expect(messages).toMatch(/subtitle: Remove promotional/);
    expect(messages).toMatch(/subtitle: Series information/);
    expect(messages).toMatch(/div/);
    expect(messages).toMatch(/web addresses/);
    expect(messages).toMatch(/reviews, ratings/);
    expect(messages).toMatch(/award-winning/i);
    expect(messages).toMatch(/at most 7 keywords/);
  });

  it("detects title and author mismatches across sources", () => {
    const findings = checkIdentityConsistency([
      {
        name: "listing",
        values: { title: "The Glass Orchard", author: "V. K. Rabenhorst" },
      },
      {
        name: "cover",
        values: { title: "The Glass  Orchard", author: "V.K. Rabenhorst" },
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.field).toBe("author");
  });
});

describe("pricing", () => {
  it("computes the 70% royalty minus delivery", () => {
    const royalty = estimateRoyalty("USD", 3.99, 1, "70");
    expect(royalty.eligible).toBe(true);
    expect(royalty.deliveryCost).toBe(0.15);
    expect(royalty.royaltyPerSale).toBe(2.69);
    expect(estimateRoyalty("USD", 0.99, 1, "70").eligible).toBe(false);
  });

  it("computes API cost from usage and flags unverified prices", () => {
    const claude = computeCostMicros(
      defaultKdpSettings,
      "anthropic",
      "claude-opus-5-5",
      {
        inputTokens: 10_000,
        outputTokens: 4_000,
        cacheReadTokens: 20_000,
        cacheWriteTokens: 0,
      },
    );
    // 10k × $4 + 4k × $20 + 20k × $0.20 per million
    expect(claude).toEqual({ costMicros: 124_000, estimated: false });
    const openai = computeCostMicros(
      defaultKdpSettings,
      "openai",
      "gpt-5.4-mini-2026-03-01",
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    );
    expect(openai.estimated).toBe(true);
    const unknown = computeCostMicros(
      defaultKdpSettings,
      "anthropic",
      "claude-future",
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    );
    expect(unknown).toEqual({ costMicros: 5_000_000, estimated: true });
  });
});
