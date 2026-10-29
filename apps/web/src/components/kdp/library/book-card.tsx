"use client";

import type { BookStage, BookSummary } from "@ai-studio/contracts";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Copy,
  FileDown,
  LoaderCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";

import { ProgressBar, Pill } from "@/components/kdp/kdp-ui";
import {
  bookStatusLabels,
  formatDate,
  formatWords,
  jobKindLabels,
  languageLabel,
  stageLabels,
} from "@/lib/kdp";

import { ActionMenu } from "./action-menu";
import { BookCover } from "./book-cover";

export type BookAction =
  "duplicate" | "archive" | "export" | "delete" | "restore";

const continuePaths: Record<BookStage, string> = {
  brief: "",
  concepts: "",
  outline: "",
  bible: "/bible",
  drafting: "/chapters",
  editing: "/chapters",
  publishing: "/publish",
};

const statusTones: Record<
  BookSummary["status"],
  "neutral" | "good" | "accent"
> = {
  draft: "neutral",
  ready: "good",
  published: "accent",
  archived: "neutral",
};

const busyLabels: Record<BookAction, string> = {
  duplicate: "Duplicating…",
  archive: "Saving…",
  export: "Exporting…",
  delete: "Deleting…",
  restore: "Restoring…",
};

const openHref = (book: BookSummary) => `/kdp/books/${book.id}`;
const continueHref = (book: BookSummary) =>
  `/kdp/books/${book.id}${continuePaths[book.stage]}`;

function jobLabel(kind: string): string {
  return (jobKindLabels as Record<string, string>)[kind] ?? "Background job";
}

type CardProps = {
  book: BookSummary;
  deleted: boolean;
  busy: BookAction | undefined;
  disabled: boolean;
  onAction: (book: BookSummary, action: BookAction) => void;
};

function ActiveJob({ book }: { book: BookSummary }) {
  const job = book.activeJob;
  if (!job) return null;
  const label = jobLabel(job.kind);
  const progress =
    job.status === "queued"
      ? "waiting to start"
      : `${Math.round(job.progress * 100)}%`;
  return (
    <div className="kdp-lib-job">
      <p>
        <LoaderCircle size={13} className="spin" aria-hidden="true" />
        <span>
          {label} · {progress}
          {job.progressLabel ? ` · ${job.progressLabel}` : ""}
        </span>
      </p>
      <ProgressBar value={job.progress} label={`${book.title}: ${label}`} />
    </div>
  );
}

function BookActions({ book, deleted, busy, disabled, onAction }: CardProps) {
  if (deleted) {
    return (
      <div className="kdp-lib-book-actions">
        <button
          type="button"
          className="button secondary small"
          disabled={disabled}
          onClick={() => onAction(book, "restore")}
        >
          <RotateCcw size={14} />{" "}
          {busy === "restore" ? "Restoring…" : "Restore"}
        </button>
      </div>
    );
  }
  const archived = book.status === "archived";
  return (
    <div className="kdp-lib-book-actions">
      <Link
        className="button primary small"
        href={continueHref(book)}
        aria-label={`Continue ${book.title} at ${stageLabels[book.stage]}`}
      >
        Continue <ArrowRight size={14} />
      </Link>
      <Link
        className="button secondary small"
        href={openHref(book)}
        aria-label={`Open ${book.title}`}
      >
        Open
      </Link>
      {busy && (
        <span className="kdp-lib-busy" role="status">
          <LoaderCircle size={13} className="spin" aria-hidden="true" />
          {busyLabels[busy]}
        </span>
      )}
      <ActionMenu
        label={`More actions for ${book.title}`}
        disabled={disabled}
        items={[
          {
            label: "Duplicate",
            icon: <Copy size={15} />,
            onSelect: () => onAction(book, "duplicate"),
          },
          {
            label: "Export files",
            icon: <FileDown size={15} />,
            onSelect: () => onAction(book, "export"),
          },
          {
            label: archived ? "Unarchive" : "Archive",
            icon: archived ? (
              <ArchiveRestore size={15} />
            ) : (
              <Archive size={15} />
            ),
            onSelect: () => onAction(book, "archive"),
          },
          {
            label: "Delete",
            icon: <Trash2 size={15} />,
            danger: true,
            onSelect: () => onAction(book, "delete"),
          },
        ]}
      />
    </div>
  );
}

function wordsLine(book: BookSummary) {
  return `${formatWords(book.actualWords)} / ${formatWords(book.brief.targetWords)}`;
}

function chaptersLine(book: BookSummary) {
  return `${book.chaptersDrafted} / ${book.chaptersPlanned || book.brief.chapterCount}`;
}

function genreLine(book: BookSummary) {
  return [
    book.subgenre ? `${book.genre} · ${book.subgenre}` : book.genre,
    languageLabel(book.language),
  ].join(" · ");
}

function seriesLine(book: BookSummary) {
  if (!book.seriesName) return null;
  return book.seriesNumber
    ? `${book.seriesName}, book ${book.seriesNumber}`
    : book.seriesName;
}

/** A book in the grid view. */
export function BookCard(props: CardProps) {
  const { book, deleted } = props;
  const series = seriesLine(book);
  const progress = book.brief.targetWords
    ? book.actualWords / book.brief.targetWords
    : 0;
  return (
    <article
      className={`kdp-lib-book${book.status === "archived" ? " archived" : ""}${deleted ? " deleted" : ""}`}
    >
      <div className="kdp-lib-book-head">
        <Link
          href={openHref(book)}
          className="kdp-lib-cover-link"
          tabIndex={-1}
          aria-hidden="true"
        >
          <BookCover book={book} />
        </Link>
        <div className="kdp-lib-book-info">
          <div className="kdp-lib-book-tags">
            <Pill tone={statusTones[book.status]}>
              {bookStatusLabels[book.status]}
            </Pill>
            <span>{stageLabels[book.stage]}</span>
          </div>
          <h2>
            <Link href={openHref(book)}>{book.title}</Link>
          </h2>
          {book.subtitle && <p className="kdp-lib-subtitle">{book.subtitle}</p>}
          <p className="kdp-lib-byline">{book.penName ?? "No pen name"}</p>
          <p className="kdp-lib-meta">{genreLine(book)}</p>
          {series && <p className="kdp-lib-meta">{series}</p>}
        </div>
      </div>
      <div className="kdp-lib-words">
        <div>
          <span>Words</span>
          <strong>{wordsLine(book)}</strong>
        </div>
        <ProgressBar value={progress} label={`${book.title}: words written`} />
      </div>
      <dl className="kdp-lib-facts">
        <div>
          <dt>Chapters</dt>
          <dd>{chaptersLine(book)}</dd>
        </div>
        <div>
          <dt>Exported</dt>
          <dd>
            {book.lastExportAt ? formatDate(book.lastExportAt) : "Not yet"}
          </dd>
        </div>
        <div>
          <dt>{deleted ? "Deleted" : "Updated"}</dt>
          <dd>{formatDate(deleted ? book.deletedAt : book.updatedAt)}</dd>
        </div>
      </dl>
      <ActiveJob book={book} />
      <BookActions {...props} />
    </article>
  );
}

/** A book in the compact list view. */
export function BookRow(props: CardProps) {
  const { book, deleted } = props;
  const series = seriesLine(book);
  return (
    <article
      className={`kdp-lib-row${book.status === "archived" ? " archived" : ""}`}
    >
      <Link
        href={openHref(book)}
        className="kdp-lib-row-cover"
        tabIndex={-1}
        aria-hidden="true"
      >
        <BookCover book={book} compact />
      </Link>
      <div className="kdp-lib-row-main">
        <h2>
          <Link href={openHref(book)}>{book.title}</Link>
        </h2>
        {book.subtitle && <p className="kdp-lib-subtitle">{book.subtitle}</p>}
        <p className="kdp-lib-meta">
          {book.penName ?? "No pen name"} · {genreLine(book)}
          {series ? ` · ${series}` : ""}
        </p>
        <ActiveJob book={book} />
      </div>
      <dl className="kdp-lib-row-stats">
        <div>
          <dt>Words</dt>
          <dd>{wordsLine(book)}</dd>
        </div>
        <div>
          <dt>Chapters</dt>
          <dd>{chaptersLine(book)}</dd>
        </div>
        <div>
          <dt>Stage</dt>
          <dd>
            {stageLabels[book.stage]}
            <small>
              {book.lastExportAt
                ? `Exported ${formatDate(book.lastExportAt)}`
                : "Not exported"}
            </small>
          </dd>
        </div>
        <div>
          <dt>{deleted ? "Deleted" : "Updated"}</dt>
          <dd>{formatDate(deleted ? book.deletedAt : book.updatedAt)}</dd>
        </div>
      </dl>
      <div className="kdp-lib-row-status">
        <Pill tone={statusTones[book.status]}>
          {bookStatusLabels[book.status]}
        </Pill>
      </div>
      <div className="kdp-lib-row-actions">
        <BookActions {...props} />
      </div>
    </article>
  );
}
