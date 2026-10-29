"use client";

import type { LengthPreset, kdpRules } from "@ai-film-studio/book-engine";
import { RefreshCw } from "lucide-react";

import { CopyButton } from "@/components/kdp/kdp-ui";
import { formatDate, formatWords, useResource } from "@/lib/kdp";

type Reference = {
  rules: typeof kdpRules;
  lengthPresets: LengthPreset[];
  craftProfiles: { id: string; label: string; techniques: string[] }[];
};

function formatList(values: readonly string[]): string {
  return values
    .map((value) => value.replace("image/", "").toUpperCase())
    .join(" or ");
}

/** The KDP numbers the studio checks against, with the source document. */
export function RulesReference() {
  const reference = useResource<Reference>("/kdp/reference");
  const data = reference.data;
  return (
    <section
      className="kdp-card"
      id="kdp-rules"
      aria-labelledby="kdp-rules-title"
    >
      <header>
        <div>
          <h2 id="kdp-rules-title">KDP rules reference</h2>
          <p>
            Amazon changes its rules. Check the reference document before
            publishing when the verification date is old.
          </p>
        </div>
      </header>
      {reference.error && (
        <div className="notice error" role="alert">
          <span>{reference.error}</span>
          <button
            type="button"
            className="button ghost small"
            onClick={() => void reference.reload()}
          >
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}
      {!data && !reference.error && (
        <div className="kdp-set-skeleton" aria-busy="true" />
      )}
      {data && (
        <>
          <dl className="kdp-set-rules-meta">
            <div>
              <dt>Rules version</dt>
              <dd>{data.rules.version}</dd>
            </div>
            <div>
              <dt>Verified</dt>
              <dd>{formatDate(data.rules.verifiedAt)}</dd>
            </div>
            <div className="wide">
              <dt>Reference document</dt>
              <dd>
                <code>{data.rules.reference}</code>
                <CopyButton value={data.rules.reference} label="Copy path" />
              </dd>
            </div>
          </dl>
          <ul className="kdp-set-rules">
            <li>
              <strong>
                {data.rules.cover.idealWidth} × {data.rules.cover.idealHeight}
              </strong>
              <span>
                Cover pixels · {formatList(data.rules.cover.formats)},{" "}
                {data.rules.cover.colorModel.toUpperCase()}
              </span>
            </li>
            <li>
              <strong>
                {formatWords(data.rules.metadata.descriptionMaxChars)}
              </strong>
              <span>Description characters</span>
            </li>
            <li>
              <strong>{data.rules.metadata.keywordsMax}</strong>
              <span>Keywords</span>
            </li>
            <li>
              <strong>{data.rules.metadata.categoriesMax}</strong>
              <span>Categories</span>
            </li>
            <li>
              <strong>
                ${data.rules.pricing.royalty70Band.USD[0]}–$
                {data.rules.pricing.royalty70Band.USD[1]}
              </strong>
              <span>70% royalty price band (USD)</span>
            </li>
            <li>
              <strong>{data.rules.metadata.titlePlusSubtitleMaxChars}</strong>
              <span>Title + subtitle characters</span>
            </li>
          </ul>
          <details className="kdp-details kdp-set-presets">
            <summary>Length presets</summary>
            <div>
              <table>
                <caption className="kdp-lib-sr">Length presets</caption>
                <thead>
                  <tr>
                    <th scope="col">Form</th>
                    <th scope="col">Words</th>
                    <th scope="col">Typical chapter</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lengthPresets
                    .filter((preset) => preset.id !== "custom")
                    .map((preset) => (
                      <tr key={preset.id}>
                        <th scope="row">{preset.label}</th>
                        <td>
                          {formatWords(preset.minWords)}–
                          {formatWords(preset.maxWords)}
                        </td>
                        <td>{formatWords(preset.wordsPerChapter)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="kdp-muted">
                Editorial ranges, not Amazon categories.
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
