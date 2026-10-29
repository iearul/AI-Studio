"use client";

import type {
  ChapterListItem,
  ConceptRecord,
  KdpJob,
  StoryBibleRecord,
} from "@ai-studio/contracts";
import { BookOpenText, Compass, Feather, Landmark, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useBook } from "@/components/kdp/book-context";
import { EmptyPanel, Pill } from "@/components/kdp/kdp-ui";
import {
  BookSettingsPanel,
  UsagePanel,
} from "@/components/kdp/writing/book-settings-panel";
import { ConceptsPanel } from "@/components/kdp/writing/concepts-panel";
import { OutlinePanel } from "@/components/kdp/writing/outline-panel";
import {
  errorMessage,
  formatUsd,
  formatWords,
  kdpPath,
  kdpSend,
  startJob,
  useResource,
} from "@/lib/kdp";

type BibleResponse = { record: StoryBibleRecord | null };

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3>{title}</h3>
      <ul className="kdp-plain-list">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function BlueprintPage() {
  const {
    bookId,
    book,
    jobs,
    activeJobs,
    refreshJobs,
    reloadBook,
    settledVersion,
  } = useBook();
  const concepts = useResource<{ items: ConceptRecord[] }>(
    kdpPath(bookId, "/concepts"),
  );
  const bible = useResource<BibleResponse>(kdpPath(bookId, "/bible"));
  const chapters = useResource<{ items: ChapterListItem[] }>(
    kdpPath(bookId, "/chapters"),
  );
  const [error, setError] = useState<string>();
  const [regenerateDrafts, setRegenerateDrafts] = useState(false);
  const [estimate, setEstimate] = useState<{
    estimatedCostMicros: number;
    spentMicros: number;
    budgetMicros: number;
  }>();
  const chapterCount = chapters.data?.items.length ?? 0;
  useEffect(() => {
    if (chapterCount === 0) return;
    const timer = setTimeout(() => {
      kdpSend<{
        estimatedCostMicros: number;
        spentMicros: number;
        budgetMicros: number;
      }>(kdpPath(bookId, "/jobs/estimate"), "POST", {
        kind: "draft",
        ...(regenerateDrafts ? { regenerate: true } : {}),
      })
        .then(setEstimate)
        .catch(() => setEstimate(undefined));
    }, 0);
    return () => clearTimeout(timer);
  }, [bookId, chapterCount, regenerateDrafts, settledVersion]);

  const reloadConcepts = concepts.reload;
  const reloadBible = bible.reload;
  const reloadChapters = chapters.reload;
  useEffect(() => {
    if (settledVersion === 0) return;
    const timer = setTimeout(() => {
      void reloadConcepts();
      void reloadBible();
      void reloadChapters();
    }, 0);
    return () => clearTimeout(timer);
  }, [settledVersion, reloadConcepts, reloadBible, reloadChapters]);

  const writeBusy = activeJobs.some((job) => job.lane === "write");
  const run = (input: Omit<Parameters<typeof startJob>[1], never>) => {
    setError(undefined);
    startJob(bookId, input)
      .then(() => refreshJobs())
      .catch((reason: unknown) => setError(errorMessage(reason)));
  };

  const conceptItems = concepts.data?.items ?? [];
  const record = bible.data?.record ?? null;
  const chapterItems = chapters.data?.items ?? [];
  const selected = conceptItems.find((concept) => concept.selected);
  const architecture = record?.bible.architecture ?? null;
  const drafted = chapterItems.filter(
    (chapter) => chapter.wordCount > 0,
  ).length;
  const lockedOrApproved = chapterItems.filter(
    (chapter) => chapter.locked || chapter.status === "approved",
  ).length;
  const lastDraft = activeJobs.find((job: KdpJob) => job.kind === "draft");

  return (
    <div className="kdp-blueprint">
      {error && <p className="notice error">{error}</p>}
      {book && (
        <details className="kdp-details kdp-brief">
          <summary>
            Brief: {book.brief.genre}, {formatWords(book.brief.targetWords)}{" "}
            words, {book.brief.chapterCount} chapters, {book.brief.pointOfView},{" "}
            {book.brief.tense} tense
          </summary>
          <div>
            <p>{book.brief.theme}</p>
            <p className="kdp-muted">
              Pacing {book.brief.pacing} · ending {book.brief.ending} · suspense{" "}
              {book.brief.suspense}/5 · horror {book.brief.horror}/5 · romance{" "}
              {book.brief.romance}/5 · violence {book.brief.violence}/5 ·
              sensuality {book.brief.sensuality}
              {book.brief.tones.length
                ? ` · ${book.brief.tones.join(", ")}`
                : ""}
            </p>
          </div>
        </details>
      )}

      {book && (
        <BookSettingsPanel
          key={book.id}
          book={book}
          onSaved={() => void reloadBook()}
        />
      )}

      <ConceptsPanel
        bookId={bookId}
        concepts={conceptItems}
        busy={writeBusy}
        onChanged={() => {
          void concepts.reload();
        }}
        onGenerate={(guidance) =>
          run({ kind: "concepts", ...(guidance ? { guidance } : {}) })
        }
      />

      <section className="kdp-card" id="bible">
        <header>
          <div>
            <span className="eyebrow">
              <Users size={13} /> Stage B
            </span>
            <h2>Story bible</h2>
            <p>
              The authoritative reference every chapter is written from:
              characters, rules, chronology, clues and style.
            </p>
          </div>
          {record && <Pill tone="good">Version {record.version}</Pill>}
        </header>
        {record ? (
          <div className="kdp-bible-summary">
            <p>
              <strong>Premise:</strong> {record.bible.premise}
            </p>
            <p>
              <strong>Theme:</strong> {record.bible.theme}
            </p>
            <p className="kdp-muted">
              {record.bible.characters.length} characters ·{" "}
              {record.bible.locations.length} locations ·{" "}
              {record.bible.clues.length} clues and payoffs ·{" "}
              {record.bible.canonFacts.length} established facts
            </p>
            <div className="kdp-actions">
              <Link
                className="button secondary small"
                href={`/kdp/books/${bookId}/bible`}
              >
                <Users size={14} /> Edit characters and bible
              </Link>
              <button
                type="button"
                className="button ghost small"
                disabled={writeBusy || !selected}
                onClick={() => {
                  if (
                    window.confirm(
                      "Build a new story bible from the chosen concept? Your current version stays in the history.",
                    )
                  )
                    run({ kind: "bible" });
                }}
              >
                Rebuild from concept
              </button>
            </div>
          </div>
        ) : (
          <EmptyPanel
            icon={<Users size={22} />}
            title="No story bible yet"
            action={
              <button
                type="button"
                className="button primary"
                disabled={writeBusy || !selected}
                onClick={() => run({ kind: "bible" })}
              >
                <Feather size={15} /> Build story bible
              </button>
            }
          >
            {selected
              ? `Built from “${selected.concept.workingTitle}”.`
              : "Choose a concept first."}
          </EmptyPanel>
        )}
      </section>

      <section className="kdp-card" id="architecture">
        <header>
          <div>
            <span className="eyebrow">
              <Landmark size={13} /> Stage C
            </span>
            <h2>Plot architecture</h2>
            <p>
              Beginning, middle and ending, settled before any chapter is
              drafted.
            </p>
          </div>
          {record && (
            <button
              type="button"
              className="button ghost small"
              disabled={writeBusy}
              onClick={() => run({ kind: "architecture" })}
            >
              {architecture ? "Redesign plot" : "Design plot"}
            </button>
          )}
        </header>
        {architecture ? (
          <div className="kdp-architecture">
            <p>
              <strong>{architecture.structure}.</strong>{" "}
              {architecture.structureRationale}
            </p>
            <div className="kdp-acts">
              {architecture.acts.map((act) => (
                <article key={act.name}>
                  <h3>{act.name}</h3>
                  <p>{act.summary}</p>
                  <small>Turn: {act.turningPoint}</small>
                </article>
              ))}
            </div>
            <div className="kdp-grid-3">
              <div>
                <h3>Beginning</h3>
                <p>{architecture.beginning}</p>
              </div>
              <div>
                <h3>Middle</h3>
                <p>{architecture.middle}</p>
              </div>
              <div>
                <h3>Ending</h3>
                <p>{architecture.ending}</p>
              </div>
            </div>
            <details className="kdp-details">
              <summary>
                Truth timeline, suspects, reveals and threat rules
              </summary>
              <div className="kdp-grid-2">
                <List
                  title="Hidden truth timeline"
                  items={architecture.truthTimeline.map(
                    (event) => `${event.when}: ${event.event}`,
                  )}
                />
                <List
                  title="Suspects"
                  items={architecture.suspects.map(
                    (suspect) =>
                      `${suspect.name}${suspect.isCulprit ? " (culprit)" : ""} — motive: ${suspect.motive}; opportunity: ${suspect.opportunity}`,
                  )}
                />
                <List title="Red herrings" items={architecture.redHerrings} />
                <List title="Reveal order" items={architecture.revealOrder} />
                <List title="Threat rules" items={architecture.threatRules} />
                <List
                  title="Relationship arc"
                  items={architecture.relationshipArc}
                />
                <List title="Tension notes" items={architecture.tensionNotes} />
              </div>
            </details>
          </div>
        ) : (
          <p className="kdp-muted">
            {record
              ? "The plot is designed together with the outline, or on its own here."
              : "Build the story bible first."}
          </p>
        )}
      </section>

      <OutlinePanel
        bookId={bookId}
        chapters={chapterItems}
        busy={writeBusy}
        canGenerate={record !== null}
        onChanged={() => {
          void chapters.reload();
        }}
        onGenerate={(guidance) =>
          run({ kind: "outline", ...(guidance ? { guidance } : {}) })
        }
        onRegenerateCard={(chapterId) =>
          run({ kind: "outline", chapterIds: [chapterId] })
        }
      />

      <section className="kdp-card" id="draft">
        <header>
          <div>
            <span className="eyebrow">
              <Compass size={13} /> Stage E
            </span>
            <h2>Draft the manuscript</h2>
            <p>
              Chapters are written in order, each with a continuity inspection
              afterwards. Locked and approved chapters are never changed. The
              job stops at the book&apos;s budget and can be resumed.
            </p>
          </div>
          <Pill
            tone={
              drafted === chapterItems.length && drafted > 0
                ? "good"
                : "neutral"
            }
          >
            {drafted} / {chapterItems.length} drafted
          </Pill>
        </header>
        {chapterItems.length === 0 ? (
          <p className="kdp-muted">Create the outline first.</p>
        ) : (
          <div className="kdp-draft-row">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={regenerateDrafts}
                onChange={(event) => setRegenerateDrafts(event.target.checked)}
              />
              <span>
                <strong>Redraft chapters that already have text</strong>
                <small>
                  {lockedOrApproved
                    ? `${lockedOrApproved} locked or approved chapter${lockedOrApproved === 1 ? "" : "s"} will be skipped.`
                    : "Earlier versions stay in each chapter's history."}
                </small>
              </span>
            </label>
            <div className="kdp-actions">
              <button
                type="button"
                className="button primary"
                disabled={
                  writeBusy ||
                  (!regenerateDrafts && drafted === chapterItems.length)
                }
                onClick={() => {
                  if (
                    !regenerateDrafts ||
                    window.confirm(
                      "Redraft every unlocked, unapproved chapter? The current text stays in each chapter's history.",
                    )
                  ) {
                    run({
                      kind: "draft",
                      ...(regenerateDrafts ? { regenerate: true } : {}),
                    });
                  }
                }}
              >
                <Feather size={15} />
                {lastDraft
                  ? "Drafting…"
                  : drafted === 0
                    ? "Draft all chapters"
                    : regenerateDrafts
                      ? "Redraft chapters"
                      : "Draft remaining chapters"}
              </button>
              <Link
                className="button secondary"
                href={`/kdp/books/${bookId}/chapters`}
              >
                <BookOpenText size={15} /> Open chapter editor
              </Link>
            </div>
            {estimate && estimate.estimatedCostMicros > 0 && (
              <p className="kdp-muted kdp-estimate">
                Estimated cost about {formatUsd(estimate.estimatedCostMicros)} ·
                spent so far {formatUsd(estimate.spentMicros)} of a{" "}
                {formatUsd(estimate.budgetMicros)} budget
                {estimate.spentMicros + estimate.estimatedCostMicros >
                estimate.budgetMicros
                  ? " — this would exceed the budget; the job will stop when it is reached."
                  : "."}
              </p>
            )}
          </div>
        )}
      </section>

      <UsagePanel bookId={bookId} jobs={jobs} version={settledVersion} />
    </div>
  );
}
