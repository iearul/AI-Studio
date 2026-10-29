"use client";

import { estimateRoyalty, kdpRules } from "@ai-studio/book-engine";
import type { BookExport, CoverAsset } from "@ai-studio/contracts";
import { Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { CopyButton, Pill } from "@/components/kdp/kdp-ui";
import { coverUrl, exportFileUrl, formatDate, languageLabel } from "@/lib/kdp";

import { descriptionPlainText } from "./description-preview";
import {
  CopyField,
  formatMegabytes,
  type MetadataResponse,
  type ProvenanceResponse,
} from "./shared";

const planLabels = {
  immediately: "Publish as soon as KDP approves it",
  preorder: "Pre-order",
  undecided: "",
} as const;

function Step({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const id = `kdp-pub-step-${number}`;
  return (
    <section className="kdp-pub-step" aria-labelledby={id}>
      <header>
        <span className="kdp-pub-step-number" aria-hidden="true">
          {number}
        </span>
        <div>
          <h3 id={id}>
            Step {number}: {title}
          </h3>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function FileLink({
  href,
  label,
  filename,
}: {
  href: string;
  label: string;
  filename?: string;
}) {
  return (
    <a className="button secondary small" href={href} download={filename}>
      <Download size={13} /> {label}
    </a>
  );
}

export function PublishingAssistant({
  bookId,
  metadata,
  provenance,
  latestExport,
  currentCover,
}: {
  bookId: string;
  metadata: MetadataResponse | undefined;
  provenance: ProvenanceResponse | undefined;
  latestExport: BookExport | undefined;
  currentCover: CoverAsset | undefined;
}) {
  const record = metadata?.record?.metadata;
  const files = latestExport?.files ?? [];
  const epub = files.find((file) => file.kind === "epub");
  const docx = files.find((file) => file.kind === "docx");
  const coverJpeg = files.find((file) => file.kind === "cover-jpeg");
  const fileSizeMB = epub ? Math.max(0.1, epub.byteSize / (1024 * 1024)) : 1;
  const royalty = record
    ? estimateRoyalty(
        record.pricing.currency,
        record.pricing.listPrice,
        fileSizeMB,
        record.pricing.royaltyPlan,
      )
    : null;
  const metadataLink = (
    <Link href={`/kdp/books/${bookId}/metadata`} className="kdp-pub-link">
      Edit in KDP Metadata
    </Link>
  );
  const keywords = record?.keywords.filter((keyword) => keyword.trim()) ?? [];
  const keywordSlots = Array.from(
    { length: kdpRules.metadata.keywordsMax },
    (_, index) => keywords[index] ?? "",
  );

  return (
    <section
      className="kdp-card kdp-pub-assistant"
      aria-labelledby="kdp-pub-assistant-title"
    >
      <header>
        <div>
          <h2 id="kdp-pub-assistant-title">KDP publishing assistant</h2>
          <p>
            Open kdp.amazon.com in another window, create a new Kindle eBook and
            copy each value into the matching field. Sign in on Amazon yourself;
            this studio never asks for your Amazon password.
          </p>
        </div>
        <a
          className="button secondary"
          href="https://kdp.amazon.com/bookshelf"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} /> Open KDP
        </a>
      </header>
      {!record && (
        <p className="notice error">
          <span>
            There is no saved listing yet, so most values are missing.{" "}
            {metadataLink}
          </span>
        </p>
      )}

      <Step
        number={1}
        title="Kindle eBook Details"
        description="Language, title, author, description, rights, audience, categories and keywords."
      >
        <dl className="kdp-pub-fields">
          <CopyField
            label="Language"
            value={record ? languageLabel(record.language) : ""}
          />
          <CopyField label="Book title" value={record?.title} />
          <CopyField label="Subtitle" value={record?.subtitle} optional />
          <CopyField label="Series" value={record?.seriesName} optional />
          <CopyField
            label="Series number"
            value={record?.seriesNumber ? String(record.seriesNumber) : ""}
            optional
          />
          <CopyField label="Edition number" value={record?.edition} optional />
          <CopyField label="Author" value={record?.penName} />
          {record && record.contributors.length > 0 ? (
            record.contributors.map((contributor, index) => (
              <CopyField
                key={index}
                label={`Contributor (${contributor.role})`}
                value={contributor.name}
              />
            ))
          ) : (
            <CopyField label="Contributors" value="" optional />
          )}
          <div className="kdp-pub-field long">
            <dt>Description</dt>
            <dd>
              {record?.description.trim() ? (
                <span className="kdp-pub-value kdp-pub-description">
                  {descriptionPlainText(record.description)}
                </span>
              ) : (
                <Pill tone="bad">Missing</Pill>
              )}
            </dd>
            <div className="kdp-pub-copy">
              {record?.description.trim() && (
                <>
                  <CopyButton value={record.description} label="Copy HTML" />
                  <CopyButton
                    value={descriptionPlainText(record.description)}
                    label="Copy text"
                  />
                </>
              )}
            </div>
          </div>
          <CopyField
            label="Publishing rights"
            value={
              record
                ? record.publishingRights === "own-copyright"
                  ? "I own the copyright and I hold the necessary publishing rights."
                  : "This is a public domain work."
                : ""
            }
          />
          <CopyField
            label="Sexually explicit images or title"
            value={record ? (record.sexuallyExplicit ? "Yes" : "No") : ""}
          />
          <CopyField
            label="Reading age (minimum)"
            value={
              record?.minimumReaderAge != null
                ? String(record.minimumReaderAge)
                : ""
            }
            optional
          />
          <CopyField
            label="Primary marketplace"
            value={record?.primaryMarketplace}
          />
          {record && record.categories.length > 0 ? (
            record.categories.map((category, index) => (
              <CopyField
                key={index}
                label={`Category ${index + 1}`}
                value={category.path}
                hint="Find it in KDP’s category picker; names can differ."
              />
            ))
          ) : (
            <CopyField label="Categories" value="" />
          )}
          {keywords.length === 0 ? (
            <CopyField label="Keywords" value="" />
          ) : (
            keywordSlots.map((keyword, index) => (
              <CopyField
                key={index}
                label={`Keyword ${index + 1}`}
                value={keyword}
                optional
              />
            ))
          )}
          <CopyField
            label="Release option"
            value={
              record
                ? record.publication.plan === "preorder"
                  ? `Pre-order, release on ${formatDate(record.publication.date)}`
                  : planLabels[record.publication.plan]
                : ""
            }
            hint={
              record?.publication.plan === "preorder" &&
              !record.publication.date
                ? "A pre-order needs a release date."
                : undefined
            }
          />
        </dl>
      </Step>

      <Step
        number={2}
        title="Kindle eBook Content"
        description="Upload the manuscript and the cover, then answer the AI content question."
      >
        <dl className="kdp-pub-fields">
          <div className="kdp-pub-field">
            <dt>Manuscript</dt>
            <dd>
              {epub || docx ? (
                <span className="kdp-pub-value">
                  Upload the EPUB (recommended) or the DOCX
                  {latestExport
                    ? ` from the export of ${formatDate(latestExport.createdAt)}`
                    : ""}
                  .
                </span>
              ) : (
                <>
                  <Pill tone="bad">Missing</Pill>
                  <small>Build an export above.</small>
                </>
              )}
            </dd>
            <div className="kdp-pub-copy">
              {latestExport && epub && (
                <FileLink
                  href={exportFileUrl(bookId, latestExport.id, epub.filename)}
                  filename={epub.filename}
                  label={`EPUB · ${formatMegabytes(epub.byteSize)}`}
                />
              )}
              {latestExport && docx && (
                <FileLink
                  href={exportFileUrl(bookId, latestExport.id, docx.filename)}
                  filename={docx.filename}
                  label="DOCX"
                />
              )}
            </div>
          </div>
          <div className="kdp-pub-field">
            <dt>Cover</dt>
            <dd>
              {coverJpeg || currentCover ? (
                <span className="kdp-pub-value">
                  Choose “Upload a cover you already have” and upload this JPEG.
                </span>
              ) : (
                <>
                  <Pill tone="bad">Missing</Pill>
                  <small>Make or upload a final cover in Cover Studio.</small>
                </>
              )}
            </dd>
            <div className="kdp-pub-copy">
              {latestExport && coverJpeg ? (
                <FileLink
                  href={exportFileUrl(
                    bookId,
                    latestExport.id,
                    coverJpeg.filename,
                  )}
                  filename={coverJpeg.filename}
                  label="Cover JPEG"
                />
              ) : currentCover ? (
                <a
                  className="button secondary small"
                  href={coverUrl(bookId, currentCover.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} /> Open cover
                </a>
              ) : null}
            </div>
          </div>
          <div className="kdp-pub-field long">
            <dt>AI-generated content</dt>
            <dd>
              {provenance ? (
                <ul className="kdp-pub-disclosure">
                  {provenance.checklist.map((item) => (
                    <li key={item.asset}>
                      <strong>{item.label}:</strong> {item.answer}{" "}
                      {item.mustDisclose && <Pill tone="accent">Disclose</Pill>}
                      {item.classification === "unknown" && (
                        <Pill tone="warn">Decide first</Pill>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="kdp-muted">Loading…</span>
              )}
              <small>
                You can change these answers in KDP Metadata under AI content
                disclosure.
              </small>
            </dd>
            <div className="kdp-pub-copy" />
          </div>
          <CopyField label="ISBN" value={record?.isbnNote} optional />
        </dl>
        <p className="kdp-pub-reminder">
          Before you upload, open the EPUB in Kindle Previewer (free from
          Amazon). After the upload, check every page in KDP’s online previewer.
        </p>
      </Step>

      <Step
        number={3}
        title="Kindle eBook Pricing"
        description="KDP Select, territories, royalty plan and price. Then publish on KDP."
      >
        <dl className="kdp-pub-fields">
          <CopyField
            label="KDP Select enrollment"
            value={
              record?.kdpSelect.enroll === true
                ? "Enroll"
                : record?.kdpSelect.enroll === false
                  ? "Do not enroll"
                  : ""
            }
            hint={
              record?.kdpSelect.enroll === null ? "Not decided yet." : undefined
            }
          />
          <CopyField
            label="Territories"
            value={
              record
                ? record.publishingRights === "own-copyright"
                  ? "All territories (worldwide rights)"
                  : "Only the territories where the work is in the public domain"
                : ""
            }
          />
          <CopyField
            label="Royalty plan"
            value={record ? `${record.pricing.royaltyPlan}%` : ""}
          />
          <CopyField
            label={`List price (${record?.pricing.currency ?? "USD"}, ${record?.primaryMarketplace ?? "primary marketplace"})`}
            value={record ? record.pricing.listPrice.toFixed(2) : ""}
            hint={
              royalty
                ? `About ${royalty.royaltyPerSale.toFixed(2)} ${record?.pricing.currency} per sale${
                    royalty.plan === "70"
                      ? ` after ${royalty.deliveryCost.toFixed(2)} delivery cost`
                      : ""
                  }.${royalty.eligible ? "" : ` ${royalty.notes[0] ?? ""}`}`
                : undefined
            }
          />
        </dl>
        <p className="kdp-pub-reminder">
          Click “Publish your Kindle eBook” on KDP when everything matches.
          KDP’s review can take up to {kdpRules.publishReviewHours} hours. Then
          record the result below.
        </p>
      </Step>
    </section>
  );
}
