"use client";

import type {
  CanonChange,
  EditorialIssue,
  EditorialKind,
  EditorialReview,
  IssueSeverity,
} from "@ai-film-studio/contracts";
import { ListChecks, LoaderCircle, ScanSearch, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { useBook } from "@/components/kdp/book-context";
import { EmptyPanel, Pill } from "@/components/kdp/kdp-ui";
import {
  editorialKindLabels,
  IssueCard,
  issueStatusLabels,
  severityLabels,
  severityOrder,
} from "@/components/kdp/publishing/editorial-issue";
import {
  StatusLine,
  useAction,
  useReloadOnSettle,
} from "@/components/kdp/publishing/shared";
import {
  formatDate,
  formatDateTime,
  kdpPath,
  kdpSend,
  startJob,
  useResource,
} from "@/lib/kdp";

type EditorialResponse = {
  reviews: EditorialReview[];
  issues: EditorialIssue[];
  canonChanges: CanonChange[];
};

type Pass = Exclude<EditorialKind, "style" | "inspection">;

const passOptions: Array<{ kind: Pass; hint: string }> = [
  {
    kind: "developmental",
    hint: "Structure, pacing, stakes, character arcs, setups and payoffs.",
  },
  {
    kind: "continuity",
    hint: "Dates, ages, places, relationships and facts across chapters.",
  },
  {
    kind: "line",
    hint: "Clarity, rhythm, dialogue and flow, keeping your voice.",
  },
  {
    kind: "copy",
    hint: "Spelling, grammar, punctuation and name consistency.",
  },
  {
    kind: "originality",
    hint: "Similarity to known works, trademarks, real people and lyrics.",
  },
];

const canonSourceLabels: Record<CanonChange["source"], string> = {
  inspection: "Chapter inspection",
  user: "You",
  editorial: "Editorial review",
};

type Filters = {
  kind: EditorialKind | "all";
  severity: IssueSeverity | "all";
  status: EditorialIssue["status"] | "all";
  chapter: string;
};

export default function EditorialPage() {
  const { bookId, activeJobs, refreshJobs, settledVersion, reloadBook } =
    useBook();
  const resource = useResource<EditorialResponse>(
    kdpPath(bookId, "/editorial"),
  );
  useReloadOnSettle(settledVersion, resource.reload);
  const { busy, status, run } = useAction();
  const [passes, setPasses] = useState<Pass[]>(
    passOptions.map((option) => option.kind),
  );
  const [filters, setFilters] = useState<Filters>({
    kind: "all",
    severity: "all",
    status: "open",
    chapter: "all",
  });
  const running = activeJobs.some((job) => job.kind === "editorial");
  const data = resource.data;

  const latestReviews = useMemo(() => {
    const byKind = new Map<EditorialKind, EditorialReview>();
    for (const review of [...(data?.reviews ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )) {
      if (!byKind.has(review.kind)) byKind.set(review.kind, review);
    }
    return [...byKind.values()];
  }, [data?.reviews]);

  const issues = useMemo(() => data?.issues ?? [], [data?.issues]);
  const kindsPresent = useMemo(
    () => [...new Set(issues.map((issue) => issue.kind))],
    [issues],
  );
  const chaptersPresent = useMemo(
    () =>
      [
        ...new Set(
          issues
            .map((issue) => issue.chapterNumber)
            .filter((value): value is number => value !== null),
        ),
      ].sort((a, b) => a - b),
    [issues],
  );
  const shown = useMemo(
    () =>
      issues
        .filter(
          (issue) =>
            (filters.kind === "all" || issue.kind === filters.kind) &&
            (filters.severity === "all" ||
              issue.severity === filters.severity) &&
            (filters.status === "all" || issue.status === filters.status) &&
            (filters.chapter === "all" ||
              (filters.chapter === "book"
                ? issue.chapterNumber === null
                : issue.chapterNumber === Number(filters.chapter))),
        )
        .sort(
          (a, b) =>
            severityOrder.indexOf(a.severity) -
              severityOrder.indexOf(b.severity) ||
            (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0) ||
            a.createdAt.localeCompare(b.createdAt),
        ),
    [issues, filters],
  );
  const openCount = issues.filter((issue) => issue.status === "open").length;
  const criticalOpen = issues.filter(
    (issue) => issue.status === "open" && issue.severity === "critical",
  ).length;
  const proposedCanon = (data?.canonChanges ?? []).filter(
    (change) => change.status === "proposed",
  );
  const otherCanon = (data?.canonChanges ?? []).filter(
    (change) => change.status !== "proposed",
  );

  const startReview = () =>
    run("review", async () => {
      await startJob(bookId, { kind: "editorial", passes });
      // Progress shows in the job panel above.
      await refreshJobs();
    });

  const styleCheck = () =>
    run("style", async () => {
      const result = await kdpSend<{ issues: EditorialIssue[] }>(
        kdpPath(bookId, "/editorial/style"),
        "POST",
      );
      resource.setData((current) => ({
        reviews: current?.reviews ?? [],
        canonChanges: current?.canonChanges ?? [],
        issues: result.issues,
      }));
      const found = result.issues.filter(
        (issue) => issue.kind === "style" && issue.status === "open",
      ).length;
      return found === 0
        ? "Style check finished: nothing to flag."
        : `Style check finished: ${found} open style notes.`;
    });

  const onUpdated = (updated: EditorialIssue, applied: boolean) => {
    resource.setData((current) => ({
      reviews: current?.reviews ?? [],
      canonChanges: current?.canonChanges ?? [],
      issues: (current?.issues ?? []).map((issue) =>
        issue.id === updated.id ? updated : issue,
      ),
    }));
    if (applied) void reloadBook();
  };

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="kdp-ed">
      <section className="kdp-card">
        <header>
          <div>
            <h2>AI editorial review</h2>
            <p>
              Choose the passes to run. Each pass reads the manuscript and lists
              issues you can accept, apply or reject.
            </p>
          </div>
        </header>
        <fieldset className="kdp-ed-passes">
          <legend className="kdp-pub-sr">Editorial passes</legend>
          {passOptions.map((option) => (
            <label key={option.kind} className="toggle-row">
              <input
                type="checkbox"
                checked={passes.includes(option.kind)}
                onChange={(event) =>
                  setPasses((current) =>
                    event.target.checked
                      ? [...current, option.kind]
                      : current.filter((kind) => kind !== option.kind),
                  )
                }
              />
              <span>
                <strong>{editorialKindLabels[option.kind]}</strong>
                <small>{option.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="kdp-actions kdp-ed-run">
          <button
            type="button"
            className="button primary"
            disabled={running || passes.length === 0 || !!busy}
            onClick={() => void startReview()}
          >
            {running || busy === "review" ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Sparkles size={15} />
            )}
            {running ? "Review running…" : "Run editorial review"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={!!busy}
            onClick={() => void styleCheck()}
          >
            {busy === "style" ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <ListChecks size={15} />
            )}
            Quick style check (free)
          </button>
        </div>
        <p className="kdp-muted">
          AI review is not professional editing and does not certify originality
          or legal clearance.
        </p>
        <StatusLine status={status} />
      </section>

      {resource.error && !data && (
        <p className="notice error">{resource.error}</p>
      )}
      {resource.loading && !data && (
        <p className="kdp-muted" aria-busy="true">
          Loading the editorial review…
        </p>
      )}

      {data && latestReviews.length > 0 && (
        <section className="kdp-ed-reviews" aria-label="Review summaries">
          {latestReviews.map((review) => (
            <article key={review.id} className="kdp-card kdp-ed-review">
              <header>
                <div>
                  <h3>{editorialKindLabels[review.kind]}</h3>
                  <p>{formatDate(review.createdAt)}</p>
                </div>
              </header>
              <p className="kdp-ed-summary">{review.summary}</p>
              {review.strengths.length > 0 && (
                <>
                  <h4>Strengths</h4>
                  <ul>
                    {review.strengths.map((strength, index) => (
                      <li key={index}>{strength}</li>
                    ))}
                  </ul>
                </>
              )}
            </article>
          ))}
        </section>
      )}

      {data && (
        <section className="kdp-card">
          <header>
            <div>
              <h2>Issues</h2>
              <p>
                {openCount} open
                {criticalOpen > 0 ? ` · ${criticalOpen} critical` : ""} ·{" "}
                {issues.length} in total
              </p>
            </div>
          </header>
          <div
            className="kdp-ed-filters"
            role="group"
            aria-label="Filter issues"
          >
            <label className="field">
              <span>Type</span>
              <select
                value={filters.kind}
                onChange={(event) =>
                  setFilter("kind", event.target.value as Filters["kind"])
                }
              >
                <option value="all">All types</option>
                {kindsPresent.map((kind) => (
                  <option key={kind} value={kind}>
                    {editorialKindLabels[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Severity</span>
              <select
                value={filters.severity}
                onChange={(event) =>
                  setFilter(
                    "severity",
                    event.target.value as Filters["severity"],
                  )
                }
              >
                <option value="all">All severities</option>
                {severityOrder.map((severity) => (
                  <option key={severity} value={severity}>
                    {severityLabels[severity]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select
                value={filters.status}
                onChange={(event) =>
                  setFilter("status", event.target.value as Filters["status"])
                }
              >
                <option value="all">All statuses</option>
                {(["open", "accepted", "rejected", "resolved"] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {issueStatusLabels[value]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              <span>Chapter</span>
              <select
                value={filters.chapter}
                onChange={(event) => setFilter("chapter", event.target.value)}
              >
                <option value="all">All chapters</option>
                <option value="book">Whole book</option>
                {chaptersPresent.map((number) => (
                  <option key={number} value={String(number)}>
                    Chapter {number}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="kdp-pub-sr" aria-live="polite">
            {shown.length} issues shown.
          </p>
          {issues.length === 0 ? (
            <EmptyPanel icon={<ScanSearch size={22} />} title="No issues yet">
              Run an editorial review or the quick style check to see issues
              here.
            </EmptyPanel>
          ) : shown.length === 0 ? (
            <p className="kdp-muted kdp-ed-none">
              No issues match these filters.
            </p>
          ) : (
            <div className="kdp-ed-issues">
              {shown.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  bookId={bookId}
                  onUpdated={onUpdated}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {data && (
        <section className="kdp-card">
          <header>
            <div>
              <h2>Proposed canon changes</h2>
              <p>
                Facts the review suggests adding to or changing in the story
                bible. Review them in Characters &amp; Bible.
              </p>
            </div>
          </header>
          {proposedCanon.length === 0 ? (
            <p className="kdp-muted">No proposed canon changes.</p>
          ) : (
            <ul className="kdp-ed-canon">
              {proposedCanon.map((change) => (
                <CanonItem key={change.id} change={change} />
              ))}
            </ul>
          )}
          {otherCanon.length > 0 && (
            <details className="kdp-details kdp-ed-canon-more">
              <summary>Earlier canon changes ({otherCanon.length})</summary>
              <div>
                <ul className="kdp-ed-canon">
                  {otherCanon.map((change) => (
                    <CanonItem key={change.id} change={change} />
                  ))}
                </ul>
              </div>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

function CanonItem({ change }: { change: CanonChange }) {
  return (
    <li>
      <div>
        <strong>{change.change}</strong>
        {change.reason && <p>{change.reason}</p>}
      </div>
      <span className="kdp-ed-canon-meta">
        <Pill
          tone={
            change.status === "accepted"
              ? "good"
              : change.status === "proposed"
                ? "accent"
                : "neutral"
          }
        >
          {change.status === "recorded"
            ? "Recorded"
            : change.status === "proposed"
              ? "Proposed"
              : change.status === "accepted"
                ? "Accepted"
                : "Rejected"}
        </Pill>
        <small>
          {canonSourceLabels[change.source]} ·{" "}
          {formatDateTime(change.createdAt)}
        </small>
      </span>
    </li>
  );
}
