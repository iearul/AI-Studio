import type { ImageValidation } from "@ai-studio/contracts";

/**
 * KDP eBook rules as researched in docs/kdp/kdp-rules-reference.md. KDP changes
 * its rules; bump the version and the verification date when re-checking.
 */
export const kdpRules = {
  version: "2026-10-29.1",
  verifiedAt: "2026-10-29",
  reference: "docs/kdp/kdp-rules-reference.md",
  manuscript: {
    formats: ["epub", "docx", "kpf"],
    rejectedFormats: ["mobi"],
    maxFileSizeMB: 650,
    maxHtmlFileSizeMB: 30,
    maxHtmlFileCount: 299,
    coverInsideManuscript: false,
  },
  cover: {
    formats: ["image/jpeg", "image/tiff"],
    idealWidth: 1600,
    idealHeight: 2560,
    ratio: 1.6,
    minWidth: 625,
    minHeight: 1000,
    maxPxPerSide: 10_000,
    maxFileSizeMB: 50,
    recommendedMaxFileSizeMB: 5,
    colorModel: "rgb",
  },
  metadata: {
    titlePlusSubtitleMaxChars: 199,
    descriptionMaxChars: 4000,
    descriptionAllowedTags: [
      "br",
      "p",
      "b",
      "em",
      "i",
      "u",
      "h4",
      "h5",
      "h6",
      "ol",
      "ul",
      "li",
    ],
    keywordsMax: 7,
    // Not stated by KDP; 50 is the commonly cited limit, used as a warning only.
    keywordSoftMaxChars: 50,
    categoriesMax: 3,
    imprintMaxChars: 100,
  },
  aiDisclosure: {
    requiredFor: ["text", "cover", "interior-images", "translation"],
    aiAssistedNeedsDisclosure: false,
    substantialEditsStillAiGenerated: true,
  },
  pricing: {
    royalty70Band: {
      USD: [2.99, 12.99],
      GBP: [1.77, 12.99],
      EUR: [2.69, 12.99],
    },
    royalty35Min: {
      // By file size: under 3 MB, 3 to 10 MB, 10 MB or more.
      USD: [0.99, 1.99, 2.99],
      GBP: [0.77, 1.25, 1.49],
      EUR: [0.89, 1.79, 2.69],
    },
    royalty35Max: { USD: 200, GBP: 150, EUR: 215 },
    deliveryCostPerMB: { USD: 0.15, GBP: 0.1, EUR: 0.12 },
    royalty70RequiresSelectIn: ["BR", "JP", "MX", "IN"],
  },
  kdpSelect: {
    termDays: 90,
    autoRenew: true,
    freePromoDaysPerTerm: 5,
    exclusiveDigital: true,
  },
  preorder: { maxLeadMonths: 18, finalManuscriptHoursBefore: 72 },
  publishReviewHours: 72,
} as const;

export type KdpCurrency = keyof typeof kdpRules.pricing.royalty70Band;

export type CoverImageFacts = {
  mimeType: string;
  width: number | null;
  height: number | null;
  colorModel: string;
  byteSize: number;
};

/**
 * Checks a cover file. Artwork only needs to be usable for composition; a final
 * cover must meet the KDP eBook cover rules.
 */
export function validateCoverImage(
  facts: CoverImageFacts,
  kind: "artwork" | "final",
): ImageValidation {
  const rules = kdpRules.cover;
  const errors: string[] = [];
  const warnings: string[] = [];
  const megabytes = facts.byteSize / (1024 * 1024);
  if (
    kind === "final" &&
    !(rules.formats as readonly string[]).includes(facts.mimeType)
  ) {
    errors.push(
      `KDP eBook covers must be JPEG or TIFF; this file is ${facts.mimeType}. Use the cover composer to export a JPEG.`,
    );
  }
  if (facts.colorModel === "cmyk") {
    errors.push("The image uses CMYK colour. KDP eBook covers must be RGB.");
  } else if (facts.colorModel === "grayscale") {
    warnings.push("The image is grayscale; KDP expects an RGB cover.");
  }
  if (megabytes > rules.maxFileSizeMB) {
    errors.push(
      `The file is ${megabytes.toFixed(1)} MB; KDP's limit is ${rules.maxFileSizeMB} MB.`,
    );
  } else if (kind === "final" && megabytes > rules.recommendedMaxFileSizeMB) {
    warnings.push(
      `The file is ${megabytes.toFixed(1)} MB. Some KDP guidance recommends staying under ${rules.recommendedMaxFileSizeMB} MB.`,
    );
  }
  if (facts.width === null || facts.height === null) {
    errors.push("The image dimensions could not be read.");
  } else {
    const { width, height } = facts;
    if (width > rules.maxPxPerSide || height > rules.maxPxPerSide) {
      errors.push(
        `Each side must be at most ${rules.maxPxPerSide.toLocaleString("en-US")} px.`,
      );
    }
    if (width >= height) {
      errors.push(
        "eBook covers are portrait: the height must be greater than the width.",
      );
    }
    if (kind === "final") {
      if (width < rules.minWidth || height < rules.minHeight) {
        errors.push(
          `${width} × ${height} px is below KDP's minimum of ${rules.minWidth} × ${rules.minHeight} px.`,
        );
      } else if (width !== rules.idealWidth || height !== rules.idealHeight) {
        warnings.push(
          `KDP recommends ${rules.idealWidth} × ${rules.idealHeight} px; this cover is ${width} × ${height} px.`,
        );
      }
      const ratio = height / width;
      if (Math.abs(ratio - rules.ratio) > 0.03) {
        warnings.push(
          `Height ÷ width is ${ratio.toFixed(2)}; KDP's ideal ratio is ${rules.ratio}:1.`,
        );
      }
    } else if (
      width < rules.idealWidth * 0.75 ||
      height < rules.idealHeight * 0.75
    ) {
      warnings.push(
        `Artwork of ${width} × ${height} px will be enlarged to fill a ${rules.idealWidth} × ${rules.idealHeight} cover and may look soft.`,
      );
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    rulesVersion: kdpRules.version,
  };
}

export type RoyaltyEstimate = {
  plan: "35" | "70";
  eligible: boolean;
  royaltyPerSale: number;
  deliveryCost: number;
  notes: string[];
};

/** Estimates royalty per sale; the 70% plan subtracts delivery cost. */
export function estimateRoyalty(
  currency: KdpCurrency,
  listPrice: number,
  fileSizeMB: number,
  plan: "35" | "70",
): RoyaltyEstimate {
  const notes: string[] = [];
  const [low, high] = kdpRules.pricing.royalty70Band[currency];
  if (plan === "70") {
    const eligible = listPrice >= low && listPrice <= high;
    if (!eligible) {
      notes.push(
        `The 70% plan needs a list price between ${low} and ${high} ${currency}.`,
      );
    }
    const deliveryCost =
      Math.round(
        kdpRules.pricing.deliveryCostPerMB[currency] * fileSizeMB * 100,
      ) / 100;
    // VAT-inclusive marketplaces compute royalty on the price without VAT;
    // the estimate uses the list price and says so.
    notes.push("Estimate before VAT; KDP's calculator is authoritative.");
    return {
      plan,
      eligible,
      deliveryCost,
      royaltyPerSale: Math.max(
        0,
        Math.round((listPrice - deliveryCost) * 0.7 * 100) / 100,
      ),
      notes,
    };
  }
  const tiers = kdpRules.pricing.royalty35Min[currency];
  const minimum =
    fileSizeMB < 3 ? tiers[0] : fileSizeMB < 10 ? tiers[1] : tiers[2];
  const maximum = kdpRules.pricing.royalty35Max[currency];
  const eligible = listPrice >= minimum && listPrice <= maximum;
  if (!eligible) {
    notes.push(
      `The 35% plan needs a list price between ${minimum} and ${maximum} ${currency} at this file size.`,
    );
  }
  notes.push("Estimate before VAT; KDP's calculator is authoritative.");
  return {
    plan,
    eligible,
    deliveryCost: 0,
    royaltyPerSale: Math.round(listPrice * 0.35 * 100) / 100,
    notes,
  };
}

/** A conservative launch-price suggestion from length; the user decides. */
export function suggestListPriceUsd(words: number): number {
  if (words < 10_000) return 0.99;
  if (words < 25_000) return 2.99;
  if (words < 50_000) return 3.99;
  if (words < 90_000) return 4.99;
  return 5.99;
}
