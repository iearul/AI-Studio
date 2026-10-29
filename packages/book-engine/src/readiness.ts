import type {
  AuthorProfile,
  Book,
  BookExport,
  BookMetadataRecord,
  BookReadiness,
  ChapterListItem,
  CoverAsset,
  EditorialIssue,
  ProvenanceRecord,
  ReadinessCheck,
} from "@ai-film-studio/contracts";

import { kdpRules } from "./kdp-rules.js";
import { checkIdentityConsistency, checkMetadata } from "./metadata-checks.js";

export type ReadinessInput = {
  book: Book;
  author: AuthorProfile | null;
  chapters: ChapterListItem[];
  openIssues: EditorialIssue[];
  editorialPassesRun: string[];
  metadata: BookMetadataRecord | null;
  cover: CoverAsset | null;
  latestExport: BookExport | null;
  provenance: ProvenanceRecord[];
  /** Latest change to chapters, metadata or cover, to detect stale exports. */
  contentUpdatedAt: string;
};

export function evaluateReadiness(input: ReadinessInput): BookReadiness {
  const checks: ReadinessCheck[] = [];
  const add = (check: ReadinessCheck) => checks.push(check);
  const { book, chapters, metadata, cover, latestExport } = input;

  // Manuscript
  const empty = chapters.filter((chapter) => chapter.wordCount === 0);
  add({
    id: "chapters-written",
    area: "manuscript",
    label: "Every chapter has text",
    status: chapters.length === 0 || empty.length > 0 ? "fail" : "pass",
    detail:
      chapters.length === 0
        ? "The book has no chapters yet."
        : empty.length > 0
          ? `Chapters without text: ${empty.map((chapter) => chapter.number).join(", ")}.`
          : `${chapters.length} chapters.`,
  });
  const words = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const target = book.brief.targetWords;
  add({
    id: "word-count",
    area: "manuscript",
    label: "Length matches the plan",
    status:
      words >= target * 0.8 ? "pass" : words >= target * 0.5 ? "warn" : "fail",
    detail: `${words.toLocaleString("en-US")} of ${target.toLocaleString("en-US")} planned words.`,
  });
  add({
    id: "front-matter",
    area: "manuscript",
    label: "Copyright page and author note",
    status:
      input.author?.copyrightNotice && input.author.aboutAuthor
        ? "pass"
        : "warn",
    detail:
      input.author?.copyrightNotice && input.author.aboutAuthor
        ? "From the pen name profile."
        : "Add a copyright notice and an About the Author text to the pen name profile.",
  });

  // Editorial
  const critical = input.openIssues.filter(
    (issue) => issue.severity === "critical",
  );
  const major = input.openIssues.filter((issue) => issue.severity === "major");
  add({
    id: "editorial-critical",
    area: "editorial",
    label: "No open critical editorial issues",
    status: critical.length > 0 ? "fail" : major.length > 0 ? "warn" : "pass",
    detail:
      critical.length > 0
        ? `${critical.length} critical and ${major.length} major issues are open.`
        : major.length > 0
          ? `${major.length} major issues are open.`
          : "No critical or major issues are open.",
  });
  const missingPasses = ["developmental", "continuity", "copy"].filter(
    (pass) => !input.editorialPassesRun.includes(pass),
  );
  add({
    id: "editorial-passes",
    area: "editorial",
    label: "Editorial passes completed",
    status: missingPasses.length === 0 ? "pass" : "warn",
    detail:
      missingPasses.length === 0
        ? "Developmental, continuity and copy passes ran."
        : `Not run yet: ${missingPasses.join(", ")}. AI review is not professional editing.`,
  });

  // Cover
  add({
    id: "cover-present",
    area: "cover",
    label: "Final eBook cover",
    status: cover ? "pass" : "fail",
    detail: cover
      ? `${cover.width} × ${cover.height} px ${cover.mimeType}.`
      : "Add or compose a final cover.",
  });
  if (cover) {
    add({
      id: "cover-valid",
      area: "cover",
      label: "Cover meets KDP rules",
      status: cover.validation.ok
        ? cover.validation.warnings.length
          ? "warn"
          : "pass"
        : "fail",
      detail:
        [...cover.validation.errors, ...cover.validation.warnings].join(" ") ||
        "All checks passed.",
    });
    const coverText = cover.settings as {
      title?: string;
      subtitle?: string | null;
      author?: string;
    };
    if (cover.source === "composite" && coverText.title && metadata) {
      const mismatches = checkIdentityConsistency([
        {
          name: "listing",
          values: {
            title: metadata.metadata.title,
            author: metadata.metadata.penName,
          },
        },
        {
          name: "cover",
          values: { title: coverText.title, author: coverText.author ?? "" },
        },
      ]);
      add({
        id: "cover-text",
        area: "cover",
        label: "Cover text matches the listing",
        status: mismatches.length ? "fail" : "pass",
        detail:
          mismatches.map((item) => item.message).join(" ") ||
          "Title and author match.",
      });
    } else {
      add({
        id: "cover-text",
        area: "cover",
        label: "Cover text matches the listing",
        status: "warn",
        detail:
          "This cover was uploaded finished; confirm it shows the same title and author name as the listing.",
      });
    }
  }

  // Metadata
  if (!metadata) {
    add({
      id: "metadata-present",
      area: "metadata",
      label: "KDP listing prepared",
      status: "fail",
      detail: "Generate or write the KDP listing.",
    });
  } else {
    const findings = checkMetadata(metadata.metadata);
    const errors = findings.filter((item) => item.level === "error");
    add({
      id: "metadata-valid",
      area: "metadata",
      label: "Listing follows KDP rules",
      status: errors.length ? "fail" : findings.length ? "warn" : "pass",
      detail:
        findings.map((item) => item.message).join(" ") || "No problems found.",
    });
    const identity = checkIdentityConsistency([
      {
        name: "book",
        values: {
          title: book.title,
          subtitle: book.subtitle,
          author: input.author?.penName ?? "",
          seriesName: book.seriesName,
          seriesNumber: book.seriesNumber,
        },
      },
      {
        name: "listing",
        values: {
          title: metadata.metadata.title,
          subtitle: metadata.metadata.subtitle,
          author: metadata.metadata.penName,
          seriesName: metadata.metadata.seriesName,
          seriesNumber: metadata.metadata.seriesNumber,
        },
      },
    ]);
    add({
      id: "metadata-consistency",
      area: "metadata",
      label: "Book, manuscript and listing agree",
      status: identity.length ? "fail" : "pass",
      detail:
        identity.map((item) => item.message).join(" ") ||
        "Title, subtitle, author and series match.",
    });
  }

  // Files
  if (
    !latestExport ||
    latestExport.status !== "succeeded" ||
    !latestExport.validation
  ) {
    add({
      id: "export-present",
      area: "files",
      label: "EPUB and DOCX exported",
      status: "fail",
      detail: latestExport?.errorMessage ?? "Run an export.",
    });
  } else {
    const validation = latestExport.validation;
    add({
      id: "export-current",
      area: "files",
      label: "Export is up to date",
      status:
        latestExport.createdAt >= input.contentUpdatedAt ? "pass" : "warn",
      detail:
        latestExport.createdAt >= input.contentUpdatedAt
          ? "Made after the last change."
          : "The book changed after the last export; export again.",
    });
    add({
      id: "epub-structure",
      area: "files",
      label: "EPUB structure and Kindle checks",
      status: validation.epubStructure.ok
        ? validation.epubStructure.warnings.length
          ? "warn"
          : "pass"
        : "fail",
      detail:
        [
          ...validation.epubStructure.errors,
          ...validation.epubStructure.warnings,
        ]
          .map((item) => item.message)
          .slice(0, 5)
          .join(" ") || "No problems found.",
    });
    add({
      id: "epubcheck",
      area: "files",
      label: "EPUBCheck",
      status: !validation.epubcheck.available
        ? "warn"
        : validation.epubcheck.passed
          ? "pass"
          : "fail",
      detail: !validation.epubcheck.available
        ? "EPUBCheck is not installed; only the built-in checks ran."
        : `EPUBCheck ${validation.epubcheck.version ?? ""}: ${validation.epubcheck.fatal} fatal, ${validation.epubcheck.errors} errors, ${validation.epubcheck.warnings} warnings. Passing EPUBCheck does not mean KDP has approved the file.`,
    });
    add({
      id: "docx",
      area: "files",
      label: "DOCX",
      status: validation.docx.ok ? "pass" : "fail",
      detail:
        validation.docx.errors.join(" ") ||
        "Built with heading styles and chapter breaks.",
    });
  }

  // Disclosure
  for (const asset of ["text", "cover"] as const) {
    const record = input.provenance.find((item) => item.asset === asset);
    add({
      id: `provenance-${asset}`,
      area: "disclosure",
      label:
        asset === "text"
          ? "Text provenance recorded"
          : "Cover provenance recorded",
      status: !record || record.classification === "unknown" ? "fail" : "pass",
      detail: record
        ? `${record.classification}${record.classification === "ai-generated" ? " — must be disclosed in KDP" : ""}.`
        : "Unknown.",
    });
  }

  // Rights
  add({
    id: "originality-review",
    area: "rights",
    label: "Originality and rights review",
    status: input.editorialPassesRun.includes("originality") ? "pass" : "warn",
    detail: input.editorialPassesRun.includes("originality")
      ? "AI review ran. It flags risks; it is not legal clearance."
      : "Run the originality and rights review in AI Editorial Review.",
  });
  add({
    id: "rights-declaration",
    area: "rights",
    label: "Publishing rights",
    status:
      metadata?.metadata.publishingRights === "own-copyright" ? "pass" : "warn",
    detail:
      metadata?.metadata.publishingRights === "own-copyright"
        ? "You declare that you hold the rights. Confirm this yourself."
        : "Confirm the publishing rights in the listing.",
  });

  const technicalChecksPass = checks.every((check) => check.status !== "fail");
  const manuscriptApproved = book.manuscriptApprovedAt !== null;
  const listingApproved = book.listingApprovedAt !== null;
  return {
    checks,
    technicalChecksPass,
    manuscriptApproved,
    listingApproved,
    readyForKdp: technicalChecksPass && manuscriptApproved && listingApproved,
    rulesVersion: kdpRules.version,
    rulesVerifiedAt: kdpRules.verifiedAt,
  };
}
