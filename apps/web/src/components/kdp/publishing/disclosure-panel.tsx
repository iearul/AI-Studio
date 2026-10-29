"use client";

import type { DisclosureAnswer } from "@ai-film-studio/book-engine";
import {
  provenanceAssets,
  provenanceClasses,
  type ProvenanceAsset,
  type ProvenanceClass,
  type ProvenanceRecord,
} from "@ai-film-studio/contracts";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Pill } from "@/components/kdp/kdp-ui";
import { kdpPath, kdpSend, useResource } from "@/lib/kdp";

import {
  provenanceLabels,
  provenanceTone,
  StatusLine,
  useAction,
  useReloadOnSettle,
  type ProvenanceResponse,
} from "./shared";

const assetLabels: Record<ProvenanceAsset, string> = {
  text: "Text",
  cover: "Cover image",
  "interior-images": "Interior images",
  translation: "Translation",
};

function DisclosureRow({
  asset,
  record,
  answer,
  busy,
  onSave,
}: {
  asset: ProvenanceAsset;
  record: ProvenanceRecord | undefined;
  answer: DisclosureAnswer | undefined;
  busy: boolean;
  onSave: (classification: ProvenanceClass, notes: string) => void;
}) {
  const [classification, setClassification] = useState<ProvenanceClass>(
    record?.classification ?? "unknown",
  );
  const [notes, setNotes] = useState(record?.notes ?? "");
  const changed =
    classification !== (record?.classification ?? "unknown") ||
    notes.trim() !== (record?.notes ?? "");
  const id = `kdp-meta-disclosure-${asset}`;
  return (
    <article className="kdp-meta-disclosure-row" aria-labelledby={id}>
      <h3 id={id}>{assetLabels[asset]}</h3>
      <dl>
        <div>
          <dt>Detected</dt>
          <dd>
            {record ? (
              <>
                <Pill tone={provenanceTone(record.detected)}>
                  {provenanceLabels[record.detected]}
                </Pill>
                <small>{record.detectedReason}</small>
              </>
            ) : (
              <Pill tone="warn">Unknown</Pill>
            )}
          </dd>
        </div>
        <div>
          <dt>Recorded</dt>
          <dd>
            <Pill tone={provenanceTone(record?.classification ?? "unknown")}>
              {provenanceLabels[record?.classification ?? "unknown"]}
            </Pill>
            {record?.overridden && <small>Set by you.</small>}
          </dd>
        </div>
        <div>
          <dt>Answer in KDP</dt>
          <dd>
            {answer ? (
              <>
                {answer.mustDisclose && <Pill tone="accent">Disclose</Pill>}{" "}
                {answer.answer}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
      <div className="kdp-meta-disclosure-edit">
        <label className="field">
          <span>Change to</span>
          <select
            value={classification}
            onChange={(event) =>
              setClassification(event.target.value as ProvenanceClass)
            }
          >
            {provenanceClasses.map((option) => (
              <option key={option} value={option}>
                {provenanceLabels[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Note</span>
          <input
            value={notes}
            maxLength={1000}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button secondary small"
          disabled={!changed || busy}
          onClick={() => onSave(classification, notes)}
        >
          {busy && <LoaderCircle size={13} className="spin" />}
          Save
        </button>
      </div>
    </article>
  );
}

/** What KDP's AI-generated content question should say for each part of the book. */
export function DisclosurePanel({
  bookId,
  settledVersion,
}: {
  bookId: string;
  settledVersion: number;
}) {
  const resource = useResource<ProvenanceResponse>(
    kdpPath(bookId, "/provenance"),
  );
  useReloadOnSettle(settledVersion, resource.reload);
  const { busy, status, run } = useAction();
  const data = resource.data;

  const save = (
    asset: ProvenanceAsset,
    classification: ProvenanceClass,
    notes: string,
  ) =>
    void run(asset, async () => {
      const result = await kdpSend<ProvenanceResponse>(
        kdpPath(bookId, `/provenance/${asset}`),
        "PUT",
        { classification, notes: notes.trim() || null },
      );
      resource.setData(result);
      return `${assetLabels[asset]} saved as ${provenanceLabels[classification]}.`;
    });

  return (
    <section
      className="kdp-card kdp-meta-disclosure"
      aria-labelledby="kdp-meta-disclosure-title"
    >
      <header>
        <div>
          <h2 id="kdp-meta-disclosure-title">AI content disclosure</h2>
          <p>
            KDP asks whether text, images and translations are AI-generated.
            Content created by AI stays AI-generated even after you edit it; AI
            used only to edit your own work is AI-assisted and does not need
            disclosure.
          </p>
        </div>
      </header>
      {resource.error && !data && (
        <p className="notice error">{resource.error}</p>
      )}
      {!data && !resource.error && (
        <p className="kdp-muted" aria-busy="true">
          Loading…
        </p>
      )}
      {data && (
        <div className="kdp-meta-disclosure-rows">
          {provenanceAssets.map((asset) => {
            const record = data.records.find((item) => item.asset === asset);
            return (
              <DisclosureRow
                key={`${asset}-${record?.updatedAt ?? "none"}`}
                asset={asset}
                record={record}
                answer={data.checklist.find((item) => item.asset === asset)}
                busy={busy === asset}
                onSave={(classification, notes) =>
                  save(asset, classification, notes)
                }
              />
            );
          })}
        </div>
      )}
      <StatusLine status={status} />
    </section>
  );
}
