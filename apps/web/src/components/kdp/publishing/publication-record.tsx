"use client";

import {
  publicationStatuses,
  type PublicationRecord,
  type PublicationStatus,
} from "@ai-studio/contracts";
import { LoaderCircle, Save } from "lucide-react";
import { useState } from "react";

import { formatDateTime, kdpPath, kdpSend } from "@/lib/kdp";

import { StatusLine, useAction } from "./shared";

const statusLabels: Record<PublicationStatus, string> = {
  "not-published": "Not published",
  submitted: "Submitted to KDP",
  live: "Live on Amazon",
  unpublished: "Unpublished",
};

type Draft = {
  status: PublicationStatus;
  publishedAt: string;
  asin: string;
  amazonUrl: string;
  finalTitle: string;
  notes: string;
};

function toDraft(record: PublicationRecord): Draft {
  return {
    status: record.status,
    publishedAt: record.publishedAt?.slice(0, 10) ?? "",
    asin: record.asin ?? "",
    amazonUrl: record.amazonUrl ?? "",
    finalTitle: record.finalTitle ?? "",
    notes: record.notes ?? "",
  };
}

function problemsOf(draft: Draft): string[] {
  const problems: string[] = [];
  const asin = draft.asin.trim();
  if (asin && !/^[A-Z0-9]{10}$/.test(asin)) {
    problems.push("An ASIN has exactly 10 capital letters or digits.");
  }
  const url = draft.amazonUrl.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol))
        throw new Error("protocol");
    } catch {
      problems.push("Enter the full Amazon address, starting with https://.");
    }
  }
  return problems;
}

/** What happened on KDP, recorded by hand after publishing there. */
export function PublicationRecordForm({
  bookId,
  record,
  onSaved,
}: {
  bookId: string;
  record: PublicationRecord;
  onSaved: (record: PublicationRecord) => void;
}) {
  const [initial, setInitial] = useState(() => toDraft(record));
  const [draft, setDraft] = useState(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const { busy, status, run } = useAction();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = () => {
    const found = problemsOf(draft);
    setProblems(found);
    if (found.length > 0) return;
    void run("save", async () => {
      const saved = await kdpSend<PublicationRecord>(
        kdpPath(bookId, "/publication"),
        "PUT",
        {
          status: draft.status,
          publishedAt: draft.publishedAt || null,
          asin: draft.asin.trim() || null,
          amazonUrl: draft.amazonUrl.trim() || null,
          finalTitle: draft.finalTitle.trim() || null,
          notes: draft.notes.trim() || null,
        },
      );
      setInitial(toDraft(saved));
      setDraft(toDraft(saved));
      onSaved(saved);
      return "Publication record saved.";
    });
  };

  return (
    <section
      className="kdp-card kdp-pub-record"
      aria-labelledby="kdp-pub-record-title"
    >
      <header>
        <div>
          <h2 id="kdp-pub-record-title">Publication record</h2>
          <p>
            After you publish on KDP, note the result here. Last updated{" "}
            {formatDateTime(record.updatedAt)}.
          </p>
        </div>
      </header>
      <div className="field-grid">
        <label className="field">
          <span>Status</span>
          <select
            value={draft.status}
            onChange={(event) =>
              set("status", event.target.value as PublicationStatus)
            }
          >
            {publicationStatuses.map((value) => (
              <option key={value} value={value}>
                {statusLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Published on</span>
          <input
            type="date"
            value={draft.publishedAt}
            onChange={(event) => set("publishedAt", event.target.value)}
          />
        </label>
        <label className="field">
          <span>ASIN</span>
          <input
            value={draft.asin}
            maxLength={10}
            autoComplete="off"
            spellCheck={false}
            placeholder="B0XXXXXXXX"
            onChange={(event) =>
              set("asin", event.target.value.toUpperCase().replace(/\s/g, ""))
            }
          />
          <small>{draft.asin.length} / 10</small>
        </label>
        <label className="field">
          <span>Amazon product page</span>
          <input
            type="url"
            value={draft.amazonUrl}
            maxLength={500}
            placeholder="https://www.amazon.com/dp/…"
            onChange={(event) => set("amazonUrl", event.target.value)}
          />
        </label>
        <label className="field full">
          <span>Final published title</span>
          <input
            value={draft.finalTitle}
            maxLength={250}
            onChange={(event) => set("finalTitle", event.target.value)}
          />
        </label>
        <label className="field full">
          <span>Notes</span>
          <textarea
            rows={3}
            value={draft.notes}
            maxLength={4000}
            onChange={(event) => set("notes", event.target.value)}
          />
        </label>
      </div>
      {problems.length > 0 && (
        <ul className="kdp-meta-problems" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div className="kdp-actions kdp-pub-record-actions">
        <button
          type="button"
          className="button primary"
          disabled={!dirty || !!busy}
          onClick={save}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Save size={15} />
          )}
          Save record
        </button>
        <span className={`kdp-saved ${dirty ? "dirty" : ""}`}>
          {dirty ? "Unsaved changes" : "Saved"}
        </span>
      </div>
      <StatusLine status={status} />
    </section>
  );
}
