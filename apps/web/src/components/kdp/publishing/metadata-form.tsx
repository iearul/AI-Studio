"use client";

import {
  checkIdentityConsistency,
  checkMetadata,
  estimateRoyalty,
  kdpRules,
  type MetadataFinding,
} from "@ai-studio/book-engine";
import {
  marketplaces,
  type BookMetadata,
  type BookMetadataRecord,
  type BookSummary,
  type Marketplace,
} from "@ai-studio/contracts";
import {
  CheckCircle2,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Pill } from "@/components/kdp/kdp-ui";
import { formatDateTime, kdpPath, kdpSend, languageOptions } from "@/lib/kdp";

import { DescriptionPreview } from "./description-preview";
import {
  FindingList,
  formatMegabytes,
  StatusLine,
  type MetadataResponse,
  type useAction,
} from "./shared";

type Currency = BookMetadata["pricing"]["currency"];
type Action = ReturnType<typeof useAction>;

const KEYWORD_SLOTS = kdpRules.metadata.keywordsMax;
const contributorRoles = [
  "Editor",
  "Foreword",
  "Illustrator",
  "Introduction",
  "Narrator",
  "Photographer",
  "Preface",
  "Translator",
  "Contributor",
];

export function defaultMetadata(book: BookSummary): BookMetadata {
  return {
    title: book.title,
    subtitle: book.subtitle,
    seriesName: book.seriesName,
    seriesNumber: book.seriesNumber,
    edition: null,
    penName: book.penName ?? "",
    contributors: [],
    language: book.language,
    description: "",
    keywords: [],
    categories: [],
    primaryMarketplace: book.language === "de" ? "amazon.de" : "amazon.com",
    audience: "",
    sexuallyExplicit: false,
    explicitContentAssessment: "",
    minimumReaderAge: null,
    contentWarnings: [],
    publishingRights: "own-copyright",
    pricing: {
      currency: "USD",
      listPrice: 2.99,
      royaltyPlan: "70",
      rationale: "",
    },
    kdpSelect: { enroll: null, notes: "" },
    publication: { plan: "undecided", date: null, notes: "" },
    publisher: null,
    imprint: null,
    isbnNote:
      "Kindle eBooks do not need an ISBN; Amazon assigns an ASIN. A paperback needs its own ISBN.",
    checklist: {},
  };
}

function padKeywords(keywords: string[]): string[] {
  return [...keywords, ...Array<string>(KEYWORD_SLOTS).fill("")].slice(
    0,
    KEYWORD_SLOTS,
  );
}

const blank = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
};

/** The form as the API expects it: trimmed, empty rows removed. */
export function cleanMetadata(draft: BookMetadata): BookMetadata {
  return {
    ...draft,
    title: draft.title.trim(),
    subtitle: blank(draft.subtitle),
    seriesName: blank(draft.seriesName),
    edition: blank(draft.edition),
    penName: draft.penName.trim(),
    contributors: draft.contributors
      .filter((item) => item.name.trim())
      .map((item) => ({
        role: item.role.trim() || "Contributor",
        name: item.name.trim(),
      })),
    language: draft.language.trim(),
    description: draft.description.trim(),
    keywords: draft.keywords.map((keyword) => keyword.trim()).filter(Boolean),
    categories: draft.categories
      .filter((item) => item.path.trim())
      .map((item) => ({
        path: item.path.trim(),
        rationale: item.rationale.trim() || "Chosen by the author.",
      })),
    audience: draft.audience.trim(),
    explicitContentAssessment: draft.explicitContentAssessment.trim(),
    contentWarnings: draft.contentWarnings
      .map((item) => item.trim())
      .filter(Boolean),
    pricing: { ...draft.pricing, rationale: draft.pricing.rationale.trim() },
    kdpSelect: { ...draft.kdpSelect, notes: draft.kdpSelect.notes.trim() },
    publication: {
      ...draft.publication,
      date: blank(draft.publication.date),
      notes: draft.publication.notes.trim(),
    },
    publisher: blank(draft.publisher),
    imprint: blank(draft.imprint),
    isbnNote: draft.isbnNote.trim(),
  };
}

function numberProblems(draft: BookMetadata): string[] {
  const problems: string[] = [];
  const price = draft.pricing.listPrice;
  if (!Number.isFinite(price) || price < 0.99 || price > 250) {
    problems.push("Enter a list price between 0.99 and 250.");
  }
  if (
    draft.seriesNumber !== null &&
    (!Number.isInteger(draft.seriesNumber) ||
      draft.seriesNumber < 1 ||
      draft.seriesNumber > 999)
  ) {
    problems.push("The series number must be a whole number from 1 to 999.");
  }
  if (
    draft.minimumReaderAge !== null &&
    (!Number.isInteger(draft.minimumReaderAge) ||
      draft.minimumReaderAge < 0 ||
      draft.minimumReaderAge > 21)
  ) {
    problems.push(
      "The minimum reader age must be a whole number from 0 to 21.",
    );
  }
  return problems;
}

const parseOptionalInt = (value: string) =>
  value.trim() === "" ? null : Number(value);
const numberValue = (value: number | null) =>
  value === null || Number.isNaN(value) ? "" : String(value);

function Section({
  title,
  description,
  children,
  findings,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  findings?: MetadataFinding[];
}) {
  return (
    <section className="kdp-card kdp-meta-section">
      <header>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </header>
      {findings && findings.length > 0 && <FindingList findings={findings} />}
      {children}
    </section>
  );
}

export function MetadataForm({
  bookId,
  book,
  response,
  epubBytes,
  action,
  onSaved,
  onApprovalChanged,
}: {
  bookId: string;
  book: BookSummary;
  response: MetadataResponse;
  epubBytes: number | null;
  action: Action;
  onSaved: (record: BookMetadataRecord) => void;
  onApprovalChanged: () => void;
}) {
  const [initial] = useState<BookMetadata>(() => {
    const source = response.record?.metadata ?? defaultMetadata(book);
    return { ...source, keywords: padKeywords(source.keywords) };
  });
  const [draft, setDraft] = useState<BookMetadata>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const { busy, status, run } = action;
  const rules = response.rules;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const cleaned = useMemo(() => cleanMetadata(draft), [draft]);
  const findings = useMemo(() => checkMetadata(cleaned), [cleaned]);
  const errors = findings.filter((finding) => finding.level === "error");
  const warnings = findings.filter((finding) => finding.level === "warning");
  const byField = (...fields: string[]) =>
    findings.filter((finding) => fields.includes(finding.field));

  const identity = useMemo(
    () =>
      checkIdentityConsistency([
        {
          name: "the book",
          values: {
            title: book.title,
            subtitle: book.subtitle,
            author: book.penName ?? "",
            seriesName: book.seriesName,
            seriesNumber: book.seriesNumber,
          },
        },
        {
          name: "this listing",
          values: {
            title: cleaned.title,
            subtitle: cleaned.subtitle,
            author: cleaned.penName,
            seriesName: cleaned.seriesName,
            seriesNumber: cleaned.seriesNumber,
          },
        },
      ]),
    [book, cleaned],
  );
  const coverMismatches = response.consistency.filter((finding) =>
    finding.message.includes("cover has"),
  );

  const fileSizeMB = epubBytes ? Math.max(0.1, epubBytes / (1024 * 1024)) : 1;
  const royalty = Number.isFinite(draft.pricing.listPrice)
    ? estimateRoyalty(
        draft.pricing.currency,
        draft.pricing.listPrice,
        fileSizeMB,
        draft.pricing.royaltyPlan,
      )
    : null;
  const band = rules.pricing.royalty70Band[draft.pricing.currency];
  const approvedAt = book.listingApprovedAt;

  const set = <K extends keyof BookMetadata>(key: K, value: BookMetadata[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setPricing = (patch: Partial<BookMetadata["pricing"]>) =>
    setDraft((current) => ({
      ...current,
      pricing: { ...current.pricing, ...patch },
    }));
  const setSelect = (patch: Partial<BookMetadata["kdpSelect"]>) =>
    setDraft((current) => ({
      ...current,
      kdpSelect: { ...current.kdpSelect, ...patch },
    }));
  const setPublication = (patch: Partial<BookMetadata["publication"]>) =>
    setDraft((current) => ({
      ...current,
      publication: { ...current.publication, ...patch },
    }));
  const updateAt = <T,>(list: T[], index: number, value: T) =>
    list.map((item, position) => (position === index ? value : item));

  const applyBookValues = () =>
    setDraft((current) => ({
      ...current,
      title: book.title,
      subtitle: book.subtitle,
      seriesName: book.seriesName,
      seriesNumber: book.seriesNumber,
      penName: book.penName ?? current.penName,
    }));

  const save = () => {
    const found = numberProblems(draft);
    setProblems(found);
    if (found.length > 0) return;
    void run("save", async () => {
      const record = await kdpSend<BookMetadataRecord>(
        kdpPath(bookId, "/metadata"),
        "PUT",
        cleaned,
      );
      onSaved(record);
      return approvedAt
        ? "Listing saved. Approval was withdrawn because the listing changed; approve it again when ready."
        : "Listing saved.";
    });
  };

  const setApproval = (approved: boolean) =>
    run("approval", async () => {
      await kdpSend(kdpPath(bookId, "/approval"), "POST", {
        field: "listing",
        approved,
      });
      onApprovalChanged();
      return approved ? "Listing approved." : "Approval withdrawn.";
    });

  const descriptionLength = draft.description.trim().length;
  const descriptionMax = rules.metadata.descriptionMaxChars;
  const softMax = rules.metadata.keywordSoftMaxChars;

  return (
    <div className="kdp-meta-form">
      <div className="kdp-meta-summary" aria-live="polite">
        {errors.length === 0 && warnings.length === 0 ? (
          <Pill tone="good">
            <CheckCircle2 size={12} aria-hidden="true" /> No problems found
          </Pill>
        ) : (
          <>
            {errors.length > 0 && (
              <Pill tone="bad">{errors.length} to fix</Pill>
            )}
            {warnings.length > 0 && (
              <Pill tone="warn">{warnings.length} to check</Pill>
            )}
          </>
        )}
        <span className="kdp-muted">
          Checked against KDP rules version {rules.version} (verified{" "}
          {rules.verifiedAt}).
        </span>
      </div>

      <Section
        title="Title and author"
        description="These must match the book, the manuscript and the cover exactly."
        findings={byField("title", "subtitle", "penName", "seriesNumber")}
      >
        {(identity.length > 0 || coverMismatches.length > 0) && (
          <div className="kdp-meta-mismatch">
            <FindingList
              findings={[
                ...identity.map((finding) => ({
                  ...finding,
                  level: "warning" as const,
                })),
                ...coverMismatches,
              ]}
            />
            {identity.length > 0 && (
              <button
                type="button"
                className="button ghost small"
                onClick={applyBookValues}
              >
                <RotateCcw size={13} /> Use the book’s values
              </button>
            )}
          </div>
        )}
        <div className="field-grid">
          <label className="field full">
            <span>Book title</span>
            <input
              value={draft.title}
              maxLength={200}
              onChange={(event) => set("title", event.target.value)}
            />
          </label>
          <label className="field full">
            <span>Subtitle (optional)</span>
            <input
              value={draft.subtitle ?? ""}
              maxLength={200}
              onChange={(event) => set("subtitle", event.target.value)}
            />
            <small>
              Title and subtitle:{" "}
              {cleaned.title.length + (cleaned.subtitle?.length ?? 0)} /{" "}
              {rules.metadata.titlePlusSubtitleMaxChars}
            </small>
          </label>
          <label className="field">
            <span>Series name (optional)</span>
            <input
              value={draft.seriesName ?? ""}
              maxLength={200}
              onChange={(event) => set("seriesName", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Number in series</span>
            <input
              type="number"
              min={1}
              max={999}
              step={1}
              value={numberValue(draft.seriesNumber)}
              onChange={(event) =>
                set("seriesNumber", parseOptionalInt(event.target.value))
              }
            />
          </label>
          <label className="field">
            <span>Edition number (optional)</span>
            <input
              value={draft.edition ?? ""}
              maxLength={40}
              onChange={(event) => set("edition", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Author (pen name)</span>
            <input
              value={draft.penName}
              maxLength={120}
              onChange={(event) => set("penName", event.target.value)}
            />
          </label>
        </div>
        <fieldset className="kdp-meta-list">
          <legend>Contributors (optional)</legend>
          {draft.contributors.map((contributor, index) => (
            <div key={index} className="kdp-meta-row">
              <label className="field">
                <span>Role</span>
                <select
                  value={contributor.role}
                  onChange={(event) =>
                    set(
                      "contributors",
                      updateAt(draft.contributors, index, {
                        ...contributor,
                        role: event.target.value,
                      }),
                    )
                  }
                >
                  {[
                    ...(contributorRoles.includes(contributor.role)
                      ? []
                      : [contributor.role]),
                    ...contributorRoles,
                  ].map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Name</span>
                <input
                  value={contributor.name}
                  maxLength={120}
                  onChange={(event) =>
                    set(
                      "contributors",
                      updateAt(draft.contributors, index, {
                        ...contributor,
                        name: event.target.value,
                      }),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove contributor ${index + 1}`}
                onClick={() =>
                  set(
                    "contributors",
                    draft.contributors.filter(
                      (_, position) => position !== index,
                    ),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {draft.contributors.length < 10 && (
            <button
              type="button"
              className="button ghost small"
              onClick={() =>
                set("contributors", [
                  ...draft.contributors,
                  { role: "Editor", name: "" },
                ])
              }
            >
              <Plus size={13} /> Add contributor
            </button>
          )}
        </fieldset>
        <div className="field-grid">
          <label className="field">
            <span>Language</span>
            <select
              value={draft.language}
              onChange={(event) => set("language", event.target.value)}
            >
              {[
                ...(languageOptions.some(
                  (option) => option.code === draft.language,
                )
                  ? []
                  : [{ code: draft.language, label: draft.language }]),
                ...languageOptions,
              ].map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Primary marketplace</span>
            <select
              value={draft.primaryMarketplace}
              onChange={(event) =>
                set("primaryMarketplace", event.target.value as Marketplace)
              }
            >
              {marketplaces.map((marketplace) => (
                <option key={marketplace} value={marketplace}>
                  {marketplace}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Section>

      <Section
        title="Description"
        description="Shown on the Amazon product page. Only simple formatting tags are allowed."
        findings={byField("description")}
      >
        <div className="kdp-meta-description">
          <label className="field">
            <span>Description (HTML allowed)</span>
            <textarea
              rows={14}
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
              aria-describedby="kdp-meta-description-count kdp-meta-description-tags"
            />
            <small
              id="kdp-meta-description-count"
              className={
                descriptionLength > descriptionMax ? "kdp-meta-over" : ""
              }
            >
              {descriptionLength.toLocaleString("en-US")} /{" "}
              {descriptionMax.toLocaleString("en-US")} characters, including
              HTML
            </small>
          </label>
          <div>
            <span className="kdp-meta-label">Preview</span>
            <DescriptionPreview html={draft.description} />
          </div>
        </div>
        <p id="kdp-meta-description-tags" className="kdp-meta-tags">
          Allowed tags:{" "}
          {rules.metadata.descriptionAllowedTags.map((tag) => (
            <code key={tag}>&lt;{tag}&gt;</code>
          ))}
        </p>
      </Section>

      <Section
        title="Keywords"
        description="Up to seven words or short phrases readers might search for. Do not repeat the title or use store terms."
        findings={byField("keywords")}
      >
        <div className="kdp-meta-keywords">
          {draft.keywords.map((keyword, index) => (
            <label key={index} className="field">
              <span>Keyword {index + 1}</span>
              <input
                value={keyword}
                maxLength={80}
                onChange={(event) =>
                  set(
                    "keywords",
                    updateAt(draft.keywords, index, event.target.value),
                  )
                }
              />
              <small
                className={
                  keyword.trim().length > softMax ? "kdp-meta-over" : ""
                }
              >
                {keyword.trim().length} / {softMax}
              </small>
            </label>
          ))}
        </div>
      </Section>

      <Section
        title="Categories"
        description="Suggestions only. Choose each category yourself in KDP’s category picker; the names there may differ."
        findings={byField("categories")}
      >
        <div className="kdp-meta-categories">
          {draft.categories.map((category, index) => (
            <div key={index} className="kdp-meta-category">
              <label className="field">
                <span>Category {index + 1}</span>
                <input
                  value={category.path}
                  maxLength={300}
                  placeholder="Kindle eBooks › Mystery, Thriller & Suspense › …"
                  onChange={(event) =>
                    set(
                      "categories",
                      updateAt(draft.categories, index, {
                        ...category,
                        path: event.target.value,
                      }),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Why it fits</span>
                <textarea
                  rows={2}
                  value={category.rationale}
                  maxLength={600}
                  onChange={(event) =>
                    set(
                      "categories",
                      updateAt(draft.categories, index, {
                        ...category,
                        rationale: event.target.value,
                      }),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove category ${index + 1}`}
                onClick={() =>
                  set(
                    "categories",
                    draft.categories.filter(
                      (_, position) => position !== index,
                    ),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {draft.categories.length < rules.metadata.categoriesMax && (
            <button
              type="button"
              className="button ghost small"
              onClick={() =>
                set("categories", [
                  ...draft.categories,
                  { path: "", rationale: "" },
                ])
              }
            >
              <Plus size={13} /> Add category
            </button>
          )}
        </div>
      </Section>

      <Section title="Audience and content">
        <div className="field-grid">
          <label className="field full">
            <span>Intended audience</span>
            <textarea
              rows={2}
              value={draft.audience}
              maxLength={600}
              onChange={(event) => set("audience", event.target.value)}
            />
          </label>
          <fieldset className="kdp-meta-choice full">
            <legend>Sexually explicit images or title?</legend>
            <label>
              <input
                type="radio"
                name="explicit"
                checked={!draft.sexuallyExplicit}
                onChange={() => set("sexuallyExplicit", false)}
              />
              No
            </label>
            <label>
              <input
                type="radio"
                name="explicit"
                checked={draft.sexuallyExplicit}
                onChange={() => set("sexuallyExplicit", true)}
              />
              Yes
            </label>
          </fieldset>
          <label className="field full">
            <span>Assessment of explicit content</span>
            <textarea
              rows={3}
              value={draft.explicitContentAssessment}
              maxLength={1000}
              onChange={(event) =>
                set("explicitContentAssessment", event.target.value)
              }
            />
          </label>
          <label className="field">
            <span>Minimum reader age (optional)</span>
            <input
              type="number"
              min={0}
              max={21}
              step={1}
              value={numberValue(draft.minimumReaderAge)}
              onChange={(event) =>
                set("minimumReaderAge", parseOptionalInt(event.target.value))
              }
            />
          </label>
        </div>
        <fieldset className="kdp-meta-list">
          <legend>Content warnings (optional)</legend>
          {draft.contentWarnings.map((warning, index) => (
            <div key={index} className="kdp-meta-row single">
              <label className="field">
                <span className="kdp-pub-sr">Content warning {index + 1}</span>
                <input
                  value={warning}
                  maxLength={120}
                  onChange={(event) =>
                    set(
                      "contentWarnings",
                      updateAt(
                        draft.contentWarnings,
                        index,
                        event.target.value,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove content warning ${index + 1}`}
                onClick={() =>
                  set(
                    "contentWarnings",
                    draft.contentWarnings.filter(
                      (_, position) => position !== index,
                    ),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {draft.contentWarnings.length < 10 && (
            <button
              type="button"
              className="button ghost small"
              onClick={() =>
                set("contentWarnings", [...draft.contentWarnings, ""])
              }
            >
              <Plus size={13} /> Add content warning
            </button>
          )}
        </fieldset>
      </Section>

      <Section title="Rights and publisher" findings={byField("imprint")}>
        <fieldset className="kdp-meta-choice">
          <legend>Publishing rights</legend>
          <label>
            <input
              type="radio"
              name="rights"
              checked={draft.publishingRights === "own-copyright"}
              onChange={() => set("publishingRights", "own-copyright")}
            />
            I own the copyright and hold the publishing rights
          </label>
          <label>
            <input
              type="radio"
              name="rights"
              checked={draft.publishingRights === "public-domain"}
              onChange={() => set("publishingRights", "public-domain")}
            />
            This is a public domain work
          </label>
        </fieldset>
        <div className="field-grid">
          <label className="field">
            <span>Publisher (optional)</span>
            <input
              value={draft.publisher ?? ""}
              maxLength={120}
              onChange={(event) => set("publisher", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Imprint (optional)</span>
            <input
              value={draft.imprint ?? ""}
              maxLength={rules.metadata.imprintMaxChars}
              onChange={(event) => set("imprint", event.target.value)}
            />
            <small>
              {(draft.imprint ?? "").length} / {rules.metadata.imprintMaxChars}
            </small>
          </label>
          <label className="field full">
            <span>ISBN note</span>
            <textarea
              rows={2}
              value={draft.isbnNote}
              maxLength={1000}
              onChange={(event) => set("isbnNote", event.target.value)}
            />
          </label>
        </div>
      </Section>

      <Section
        title="Pricing and KDP Select"
        description="Royalty figures are estimates. KDP’s own calculator is authoritative."
      >
        <div className="field-grid kdp-meta-pricing">
          <label className="field">
            <span>Currency</span>
            <select
              value={draft.pricing.currency}
              onChange={(event) =>
                setPricing({ currency: event.target.value as Currency })
              }
            >
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <label className="field">
            <span>List price</span>
            <input
              type="number"
              min={0.99}
              max={250}
              step={0.01}
              value={numberValue(draft.pricing.listPrice)}
              onChange={(event) =>
                setPricing({
                  listPrice:
                    event.target.value === ""
                      ? Number.NaN
                      : Number(event.target.value),
                })
              }
            />
          </label>
          <fieldset className="kdp-meta-choice">
            <legend>Royalty plan</legend>
            {(["70", "35"] as const).map((plan) => (
              <label key={plan}>
                <input
                  type="radio"
                  name="royalty"
                  checked={draft.pricing.royaltyPlan === plan}
                  onChange={() => setPricing({ royaltyPlan: plan })}
                />
                {plan}%
              </label>
            ))}
          </fieldset>
          <div className="kdp-meta-estimate" aria-live="polite">
            {royalty ? (
              <>
                <strong>
                  ≈ {royalty.royaltyPerSale.toFixed(2)} {draft.pricing.currency}{" "}
                  per sale
                </strong>
                {!royalty.eligible && (
                  <Pill tone="bad">Price outside this plan’s range</Pill>
                )}
                <small>
                  {royalty.plan === "70"
                    ? `Delivery cost ${royalty.deliveryCost.toFixed(2)} ${draft.pricing.currency} for ${
                        epubBytes
                          ? `the latest EPUB (${formatMegabytes(epubBytes)})`
                          : "a file of about 1 MB"
                      }.`
                    : "The 35% plan has no delivery cost."}{" "}
                  {royalty.notes.join(" ")}
                </small>
              </>
            ) : (
              <small>Enter a price to see an estimate.</small>
            )}
          </div>
          <p className="kdp-muted full">
            70% royalty needs a price from {band[0]} to {band[1]}{" "}
            {draft.pricing.currency}.
          </p>
          <label className="field full">
            <span>Pricing notes</span>
            <textarea
              rows={2}
              value={draft.pricing.rationale}
              maxLength={1500}
              onChange={(event) =>
                setPricing({ rationale: event.target.value })
              }
            />
          </label>
        </div>
        <fieldset className="kdp-meta-choice">
          <legend>Enroll in KDP Select?</legend>
          {(
            [
              ["yes", "Yes", true],
              ["no", "No", false],
              ["undecided", "Not decided", null],
            ] as const
          ).map(([value, label, enroll]) => (
            <label key={value}>
              <input
                type="radio"
                name="select"
                checked={draft.kdpSelect.enroll === enroll}
                onChange={() => setSelect({ enroll })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <ul className="kdp-meta-rules">
          <li>
            {rules.kdpSelect.termDays}-day terms that{" "}
            {rules.kdpSelect.autoRenew ? "renew automatically" : "do not renew"}
            .
          </li>
          {rules.kdpSelect.exclusiveDigital && (
            <li>
              The eBook must be exclusive to Amazon while enrolled; the
              paperback is not affected.
            </li>
          )}
          <li>
            {rules.kdpSelect.freePromoDaysPerTerm} free or discount promotion
            days per term.
          </li>
          <li>
            Required for 70% royalty in{" "}
            {rules.pricing.royalty70RequiresSelectIn.join(", ")}.
          </li>
        </ul>
        <label className="field">
          <span>KDP Select notes</span>
          <textarea
            rows={3}
            value={draft.kdpSelect.notes}
            maxLength={1500}
            onChange={(event) => setSelect({ notes: event.target.value })}
          />
        </label>
      </Section>

      <Section title="Release">
        <fieldset className="kdp-meta-choice">
          <legend>When to publish</legend>
          {(
            [
              ["immediately", "As soon as KDP approves it"],
              ["preorder", "Pre-order with a release date"],
              ["undecided", "Not decided"],
            ] as const
          ).map(([plan, label]) => (
            <label key={plan}>
              <input
                type="radio"
                name="plan"
                checked={draft.publication.plan === plan}
                onChange={() => setPublication({ plan })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="field-grid">
          <label className="field">
            <span>
              Release date
              {draft.publication.plan === "preorder" ? "" : " (optional)"}
            </span>
            <input
              type="date"
              value={draft.publication.date?.slice(0, 10) ?? ""}
              onChange={(event) =>
                setPublication({ date: event.target.value || null })
              }
            />
            {draft.publication.plan === "preorder" && (
              <small>
                Up to {kdpRules.preorder.maxLeadMonths} months ahead. The final
                file is due {kdpRules.preorder.finalManuscriptHoursBefore} hours
                before release.
              </small>
            )}
          </label>
          <label className="field full">
            <span>Release notes</span>
            <textarea
              rows={2}
              value={draft.publication.notes}
              maxLength={1000}
              onChange={(event) =>
                setPublication({ notes: event.target.value })
              }
            />
          </label>
        </div>
      </Section>

      <div className="kdp-meta-savebar">
        <div className="kdp-meta-savebar-state" aria-live="polite">
          <span className={`kdp-saved ${dirty ? "dirty" : ""}`}>
            {dirty
              ? "Unsaved changes"
              : response.record
                ? `Saved ${formatDateTime(response.record.updatedAt)}`
                : "Not saved yet"}
          </span>
          {approvedAt ? (
            <Pill tone="good">
              <CheckCircle2 size={12} aria-hidden="true" /> Approved{" "}
              {formatDateTime(approvedAt)}
            </Pill>
          ) : (
            <Pill tone="warn">Listing not approved</Pill>
          )}
        </div>
        {problems.length > 0 && (
          <ul className="kdp-meta-problems" role="alert">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <div className="kdp-actions">
          <button
            type="button"
            className="button primary"
            disabled={!!busy || (!dirty && !!response.record)}
            onClick={save}
          >
            {busy === "save" ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Save size={15} />
            )}
            Save listing
          </button>
          {approvedAt ? (
            <button
              type="button"
              className="button ghost"
              disabled={!!busy}
              onClick={() => void setApproval(false)}
            >
              Withdraw approval
            </button>
          ) : (
            <button
              type="button"
              className="button secondary"
              disabled={
                !!busy || dirty || !response.record || errors.length > 0
              }
              onClick={() => void setApproval(true)}
            >
              {busy === "approval" ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              Approve listing
            </button>
          )}
        </div>
        <p className="kdp-muted">
          {dirty || !response.record
            ? "Save before approving. "
            : errors.length > 0
              ? "Fix the errors before approving. "
              : ""}
          Saving a change withdraws the approval.
        </p>
        <StatusLine status={status} />
      </div>
    </div>
  );
}
