"use client";

import type {
  AuthorProfile,
  BackMatterKind,
  BookSummary,
  KdpAiRun,
  KdpCostSummary,
  KdpJob,
} from "@ai-film-studio/contracts";
import { kdpTaskLabels } from "@ai-film-studio/contracts";
import { ArrowDown, ArrowUp, Gauge, Settings2 } from "lucide-react";
import { useState } from "react";

import { Pill } from "@/components/kdp/kdp-ui";
import {
  errorMessage,
  formatDateTime,
  formatUsd,
  jobKindLabels,
  jobStatusLabels,
  kdpPath,
  kdpSend,
  useResource,
} from "@/lib/kdp";

const backMatterLabels: Record<BackMatterKind, string> = {
  "about-author": "About the author",
  "next-book-preview": "Next-book preview",
  "call-to-action": "Note to readers",
};
const allBackMatter: BackMatterKind[] = [
  "about-author",
  "next-book-preview",
  "call-to-action",
];

/** Per-book publishing details, budget and front/back matter layout. */
export function BookSettingsPanel({
  book,
  onSaved,
}: {
  book: BookSummary;
  onSaved: () => void;
}) {
  const authors = useResource<{ items: AuthorProfile[] }>("/kdp/authors");
  const [authorProfileId, setAuthorProfileId] = useState(
    book.authorProfileId ?? "",
  );
  const [title, setTitle] = useState(book.title);
  const [subtitle, setSubtitle] = useState(book.subtitle ?? "");
  const [seriesName, setSeriesName] = useState(book.seriesName ?? "");
  const [seriesNumber, setSeriesNumber] = useState(
    book.seriesNumber?.toString() ?? "",
  );
  const [budget, setBudget] = useState(
    book.settings.budgetUsd?.toString() ?? "",
  );
  const [matter, setMatter] = useState(book.settings.matter);
  const [status, setStatus] = useState<string>();

  const order = [
    ...matter.backMatter,
    ...allBackMatter.filter((kind) => !matter.backMatter.includes(kind)),
  ];
  const move = (kind: BackMatterKind, offset: number) => {
    const included = [...matter.backMatter];
    const index = included.indexOf(kind);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= included.length) return;
    included.splice(index, 1);
    included.splice(target, 0, kind);
    setMatter({ ...matter, backMatter: included });
  };

  return (
    <details className="kdp-details kdp-book-settings">
      <summary>
        <Settings2 size={14} /> Book details, budget and front/back matter
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setStatus("Saving…");
          kdpSend(kdpPath(book.id), "PATCH", {
            ...(authorProfileId ? { authorProfileId } : {}),
            title: title.trim(),
            subtitle: subtitle.trim() || null,
            seriesName: seriesName.trim() || null,
            seriesNumber: seriesNumber ? Number(seriesNumber) : null,
            settings: {
              ...book.settings,
              budgetUsd: budget === "" ? null : Number(budget),
              matter,
            },
          })
            .then(() => {
              setStatus("Saved");
              onSaved();
            })
            .catch((reason: unknown) => setStatus(errorMessage(reason)));
        }}
      >
        <div className="field-grid">
          <label className="field">
            <span>Pen name</span>
            <select
              value={authorProfileId}
              onChange={(event) => setAuthorProfileId(event.target.value)}
            >
              {(authors.data?.items ?? []).map((author) => (
                <option key={author.id} value={author.id}>
                  {author.penName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Title</span>
            <input
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Subtitle (only if it helps readers)</span>
            <input
              maxLength={200}
              value={subtitle}
              onChange={(event) => setSubtitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Series name</span>
            <input
              maxLength={200}
              value={seriesName}
              onChange={(event) => setSeriesName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Number in series</span>
            <input
              type="number"
              min={1}
              max={999}
              value={seriesNumber}
              onChange={(event) => setSeriesNumber(event.target.value)}
            />
          </label>
          <label className="field">
            <span>AI budget for this book (USD)</span>
            <input
              type="number"
              min={0}
              max={10000}
              step={0.5}
              placeholder="Studio default"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </label>
        </div>
        <h3 className="kdp-subhead">Front matter</h3>
        <div className="field-grid">
          <label className="field">
            <span>Dedication (empty uses the pen name&apos;s)</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={matter.dedication ?? ""}
              onChange={(event) =>
                setMatter({ ...matter, dedication: event.target.value || null })
              }
            />
          </label>
          <label className="field">
            <span>Content notice text</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={matter.contentNotice ?? ""}
              onChange={(event) =>
                setMatter({
                  ...matter,
                  contentNotice: event.target.value || null,
                })
              }
            />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={matter.includeContentNotice}
              onChange={(event) =>
                setMatter({
                  ...matter,
                  includeContentNotice: event.target.checked,
                })
              }
            />
            <span>
              <strong>Include a content notice</strong>
              <small>
                Uses the text above, the pen name&apos;s notice, or the
                listing&apos;s content warnings.
              </small>
            </span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={matter.includeToc}
              onChange={(event) =>
                setMatter({ ...matter, includeToc: event.target.checked })
              }
            />
            <span>
              <strong>Include a linked table of contents</strong>
              <small>
                Recommended by KDP for eBooks; the EPUB navigation is always
                included.
              </small>
            </span>
          </label>
        </div>
        <h3 className="kdp-subhead">Back matter, in this order</h3>
        <ol className="kdp-matter-order">
          {order.map((kind) => {
            const included = matter.backMatter.includes(kind);
            return (
              <li key={kind}>
                <label>
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={(event) =>
                      setMatter({
                        ...matter,
                        backMatter: event.target.checked
                          ? [...matter.backMatter, kind]
                          : matter.backMatter.filter((item) => item !== kind),
                      })
                    }
                  />
                  {backMatterLabels[kind]}
                </label>
                {included && (
                  <span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${backMatterLabels[kind]} up`}
                      onClick={() => move(kind, -1)}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${backMatterLabels[kind]} down`}
                      onClick={() => move(kind, 1)}
                    >
                      <ArrowDown size={13} />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <p className="kdp-muted">
          The texts come from the pen name profile in Settings. Sections without
          text are left out.
        </p>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={matter.embedCoverInEpub}
            onChange={(event) =>
              setMatter({ ...matter, embedCoverInEpub: event.target.checked })
            }
          />
          <span>
            <strong>Embed the cover inside the EPUB</strong>
            <small>
              Leave off for KDP: the cover is uploaded separately. Only for
              other stores that ask for it.
            </small>
          </span>
        </label>
        <div className="kdp-actions">
          <button className="button primary small">Save book settings</button>
          <span className="kdp-saved" aria-live="polite">
            {status}
          </span>
        </div>
      </form>
    </details>
  );
}

/** Generation history and cost per task, from every recorded provider call. */
export function UsagePanel({
  bookId,
  jobs,
  version,
}: {
  bookId: string;
  jobs: KdpJob[];
  version: number;
}) {
  const costs = useResource<{ summary: KdpCostSummary; runs: KdpAiRun[] }>(
    kdpPath(bookId, `/costs?v=${version}`),
  );
  const summary = costs.data?.summary;
  return (
    <details className="kdp-details kdp-usage">
      <summary>
        <Gauge size={14} /> AI usage and generation history
        {summary
          ? ` · ${formatUsd(summary.spentMicros)} of ${formatUsd(summary.budgetMicros)} budget`
          : ""}
      </summary>
      <div>
        {summary?.unverifiedPrices && (
          <p className="kdp-muted">
            Some costs use prices marked unverified in Settings; confirm them
            against the provider&apos;s price list.
          </p>
        )}
        <div className="kdp-table-wrap">
          <table className="kdp-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Calls</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.byTask ?? []).map((row) => (
                <tr key={row.task}>
                  <td>{kdpTaskLabels[row.task]}</td>
                  <td>{row.runs}</td>
                  <td>{row.inputTokens.toLocaleString("en-US")}</td>
                  <td>{row.outputTokens.toLocaleString("en-US")}</td>
                  <td>{formatUsd(row.costMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="kdp-subhead">Jobs</h3>
        <ul className="kdp-plain-list">
          {jobs.map((job) => (
            <li key={job.id}>
              {formatDateTime(job.createdAt)} · {jobKindLabels[job.kind]} ·{" "}
              <Pill
                tone={
                  job.status === "succeeded"
                    ? "good"
                    : job.status === "failed" || job.status === "budget_stopped"
                      ? "bad"
                      : "neutral"
                }
              >
                {jobStatusLabels[job.status]}
              </Pill>{" "}
              {formatUsd(job.actualCostMicros)}
              {job.estimatedCostMicros > 0
                ? ` (estimated ${formatUsd(job.estimatedCostMicros)})`
                : ""}
              {job.errorMessage ? ` — ${job.errorMessage}` : ""}
            </li>
          ))}
        </ul>
        <h3 className="kdp-subhead">Recent model calls</h3>
        <ul className="kdp-plain-list kdp-runs">
          {(costs.data?.runs ?? []).slice(0, 40).map((run) => (
            <li key={run.id}>
              {formatDateTime(run.createdAt)} · {kdpTaskLabels[run.task]} ·{" "}
              {run.model} · {run.status} · {(run.durationMs / 1000).toFixed(1)}{" "}
              s · {formatUsd(run.costMicros)}
              {run.errorMessage ? ` — ${run.errorMessage}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
