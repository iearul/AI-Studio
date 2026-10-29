import type {
  CoverAsset,
  ProvenanceAsset,
  ProvenanceClass,
  ProvenanceRecord,
  RevisionSource,
} from "@ai-studio/contracts";

export type ChapterHistoryFacts = {
  chapterNumber: number;
  hasText: boolean;
  revisionSources: RevisionSource[];
};

export type DetectedProvenance = {
  classification: ProvenanceClass;
  reason: string;
};

// KDP: AI-generated content stays AI-generated even after substantial human
// editing; AI used only to edit, refine or check human text is AI-assisted.
const generatingSources = new Set<RevisionSource>([
  "ai-draft",
  "ai-expansion",
  "ai-rewrite",
]);
const assistingSources = new Set<RevisionSource>([
  "ai-edit",
  "editorial-accept",
]);

export function detectTextProvenance(
  chapters: ChapterHistoryFacts[],
): DetectedProvenance {
  const withText = chapters.filter((chapter) => chapter.hasText);
  if (withText.length === 0) {
    return { classification: "unknown", reason: "No chapter has text yet." };
  }
  const generated = withText.filter((chapter) =>
    chapter.revisionSources.some((source) => generatingSources.has(source)),
  );
  if (generated.length > 0) {
    return {
      classification: "ai-generated",
      reason: `${generated.length} of ${withText.length} chapters contain text created by AI (drafts, expansions or rewrites). Under KDP's definition this stays AI-generated even after substantial editing.`,
    };
  }
  const assisted = withText.filter((chapter) =>
    chapter.revisionSources.some((source) => assistingSources.has(source)),
  );
  if (assisted.length > 0) {
    return {
      classification: "ai-assisted",
      reason: `All text was written in the editor; AI edits or corrections were accepted in ${assisted.length} chapters.`,
    };
  }
  const imported = withText.some((chapter) =>
    chapter.revisionSources.includes("import"),
  );
  return imported
    ? {
        classification: "unknown",
        reason: "Some text was imported; confirm who or what wrote it.",
      }
    : {
        classification: "human",
        reason: "Every chapter was written in the editor without AI text.",
      };
}

export function detectCoverProvenance(
  cover: CoverAsset | null,
  parent: CoverAsset | null,
): DetectedProvenance {
  if (!cover)
    return { classification: "unknown", reason: "No final cover yet." };
  if (cover.source === "composite" && parent) {
    return {
      classification: parent.provenance,
      reason: `Composed in Cover Studio from artwork marked ${parent.provenance}; adding typography does not change the artwork's classification.`,
    };
  }
  return {
    classification: cover.provenance,
    reason: "As declared when the cover was added.",
  };
}

export type DisclosureAnswer = {
  asset: ProvenanceAsset;
  label: string;
  classification: ProvenanceClass;
  answer: string;
  mustDisclose: boolean;
  note: string;
};

const assetLabels: Record<ProvenanceAsset, string> = {
  text: "Text",
  cover: "Images (cover)",
  "interior-images": "Images (interior)",
  translation: "Translation",
};

/** Recommended answers for KDP's AI-generated content question. */
export function disclosureChecklist(
  records: ProvenanceRecord[],
): DisclosureAnswer[] {
  return (["text", "cover", "interior-images", "translation"] as const).map(
    (asset) => {
      const record = records.find((item) => item.asset === asset);
      const classification = record?.classification ?? "unknown";
      const mustDisclose = classification === "ai-generated";
      const answer =
        classification === "ai-generated"
          ? "Yes — AI-generated. Disclose it in KDP's AI content question."
          : classification === "ai-assisted"
            ? "AI-assisted only. KDP does not require disclosure of AI-assisted content."
            : classification === "human"
              ? "No AI-generated content."
              : classification === "not-applicable"
                ? "Not applicable to this book."
                : "Unknown — decide before publishing. If in doubt, disclose.";
      return {
        asset,
        label: assetLabels[asset],
        classification,
        answer,
        mustDisclose,
        note: record?.notes ?? record?.detectedReason ?? "",
      };
    },
  );
}
