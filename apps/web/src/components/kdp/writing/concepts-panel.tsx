"use client";

import type { ConceptRecord, StoryConcept } from "@ai-film-studio/contracts";
import {
  Check,
  Lightbulb,
  PencilLine,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import { EmptyPanel, Pill } from "@/components/kdp/kdp-ui";
import { errorMessage, kdpPath, kdpSend } from "@/lib/kdp";

const fields: Array<[keyof StoryConcept, string]> = [
  ["logline", "Logline"],
  ["genrePositioning", "Genre positioning"],
  ["centralConflict", "Central conflict"],
  ["protagonist", "Protagonist"],
  ["emotionalStakes", "Emotional stakes"],
  ["coreQuestion", "Core question"],
  ["hook", "Narrative hook"],
  ["potentialEnding", "Potential ending"],
];

function ConceptEditor({
  bookId,
  record,
  onSaved,
  onCancel,
}: {
  bookId: string;
  record: ConceptRecord;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [concept, setConcept] = useState<StoryConcept>(record.concept);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="kdp-concept-edit"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        kdpSend(kdpPath(bookId, `/concepts/${record.id}`), "PUT", concept)
          .then(onSaved)
          .catch((reason: unknown) => setError(errorMessage(reason)))
          .finally(() => setSaving(false));
      }}
    >
      <label className="field">
        <span>Working title</span>
        <input
          value={concept.workingTitle}
          onChange={(event) =>
            setConcept({ ...concept, workingTitle: event.target.value })
          }
        />
      </label>
      {fields.map(([key, label]) => (
        <label className="field" key={key}>
          <span>{label}</span>
          <textarea
            rows={2}
            value={concept[key] as string}
            onChange={(event) =>
              setConcept({ ...concept, [key]: event.target.value })
            }
          />
        </label>
      ))}
      <label className="field">
        <span>Originality risks (one per line)</span>
        <textarea
          rows={2}
          value={concept.originalityRisks.join("\n")}
          onChange={(event) =>
            setConcept({
              ...concept,
              originalityRisks: event.target.value
                .split("\n")
                .filter((line) => line.trim()),
            })
          }
        />
      </label>
      {error && <p className="notice error">{error}</p>}
      <div className="kdp-actions">
        <button className="button primary small" disabled={saving}>
          Save concept
        </button>
        <button type="button" className="button ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ConceptsPanel({
  bookId,
  concepts,
  busy,
  onGenerate,
  onChanged,
}: {
  bookId: string;
  concepts: ConceptRecord[];
  busy: boolean;
  onGenerate: (guidance: string) => void;
  onChanged: () => void;
}) {
  const [guidance, setGuidance] = useState("");
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();
  const selected = concepts.find((concept) => concept.selected);
  const latestBatch = Math.max(0, ...concepts.map((concept) => concept.batch));
  const [showOlder, setShowOlder] = useState(false);
  const visible = concepts.filter(
    (concept) => showOlder || concept.batch === latestBatch || concept.selected,
  );

  const select = (concept: ConceptRecord) => {
    setError(undefined);
    kdpSend(kdpPath(bookId, `/concepts/${concept.id}/select`), "POST")
      .then(onChanged)
      .catch((reason: unknown) => setError(errorMessage(reason)));
  };

  return (
    <section className="kdp-card" id="concepts">
      <header>
        <div>
          <span className="eyebrow">
            <Lightbulb size={13} /> Stage A
          </span>
          <h2>Story concepts</h2>
          <p>
            Three original directions from your brief. Choose one, edit it, or
            ask for alternatives.
          </p>
        </div>
        {selected && (
          <Pill tone="good">Chosen: {selected.concept.workingTitle}</Pill>
        )}
      </header>
      {concepts.length === 0 ? (
        <EmptyPanel icon={<Sparkles size={22} />} title="No concepts yet">
          The idea generator turns your theme into three distinct concepts with
          their originality risks.
        </EmptyPanel>
      ) : (
        <div className="kdp-concepts">
          {visible.map((record) => (
            <article
              key={record.id}
              className={
                record.selected ? "kdp-concept selected" : "kdp-concept"
              }
            >
              {editing === record.id ? (
                <ConceptEditor
                  bookId={bookId}
                  record={record}
                  onCancel={() => setEditing(undefined)}
                  onSaved={() => {
                    setEditing(undefined);
                    onChanged();
                  }}
                />
              ) : (
                <>
                  <div className="kdp-concept-head">
                    <h3>{record.concept.workingTitle}</h3>
                    {record.selected && (
                      <Check size={18} aria-label="Chosen concept" />
                    )}
                  </div>
                  <p className="kdp-concept-logline">
                    {record.concept.logline}
                  </p>
                  <dl>
                    {fields.slice(1).map(([key, label]) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>{record.concept[key] as string}</dd>
                      </div>
                    ))}
                  </dl>
                  {record.concept.originalityRisks.length > 0 && (
                    <div className="kdp-concept-risks">
                      <strong>Originality risks</strong>
                      <ul>
                        {record.concept.originalityRisks.map((risk) => (
                          <li key={risk}>{risk}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="kdp-actions">
                    {!record.selected && (
                      <button
                        type="button"
                        className="button primary small"
                        onClick={() => select(record)}
                      >
                        <Check size={14} /> Choose
                      </button>
                    )}
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => setEditing(record.id)}
                    >
                      <PencilLine size={14} /> Edit
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
      {concepts.some((concept) => concept.batch !== latestBatch) && (
        <button
          type="button"
          className="button ghost small kdp-older"
          onClick={() => setShowOlder(!showOlder)}
        >
          {showOlder ? "Hide earlier concepts" : "Show earlier concepts"}
        </button>
      )}
      {error && <p className="notice error">{error}</p>}
      <div className="kdp-generate-row">
        <label className="field">
          <span>Direction for the next round (optional)</span>
          <input
            value={guidance}
            maxLength={4000}
            placeholder="e.g. darker, set in winter, a female antagonist"
            onChange={(event) => setGuidance(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => onGenerate(guidance)}
        >
          {concepts.length ? <RefreshCw size={15} /> : <Sparkles size={15} />}
          {concepts.length ? "Request alternatives" : "Develop 3 concepts"}
        </button>
      </div>
    </section>
  );
}
