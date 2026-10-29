"use client";

import {
  BookMarked,
  BookOpenText,
  ClipboardCheck,
  Image as ImageIcon,
  PackageCheck,
  ScanSearch,
  Tags,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { BookProvider, useBook } from "@/components/kdp/book-context";
import { JobPanel, Pill } from "@/components/kdp/kdp-ui";
import {
  bookStatusLabels,
  formatUsd,
  formatWords,
  isActiveJob,
  languageLabel,
  stageLabels,
} from "@/lib/kdp";

const tabs = [
  { path: "", label: "Story Blueprint", icon: BookMarked },
  { path: "/bible", label: "Characters & Bible", icon: Users },
  { path: "/chapters", label: "Chapter Editor", icon: BookOpenText },
  { path: "/editorial", label: "Editorial Review", icon: ScanSearch },
  { path: "/cover", label: "Cover Studio", icon: ImageIcon },
  { path: "/metadata", label: "KDP Metadata", icon: Tags },
  { path: "/publish", label: "Export & Publish", icon: PackageCheck },
];

const stageOrder = [
  "brief",
  "concepts",
  "bible",
  "outline",
  "drafting",
  "editing",
  "publishing",
] as const;

function BookHeader() {
  const {
    bookId,
    book,
    error,
    jobs,
    activeJobs,
    workerRunning,
    refreshJobs,
    reloadBook,
  } = useBook();
  const pathname = usePathname();
  if (error) return <div className="notice error">{error}</div>;
  if (!book)
    return <div className="kdp-book-header skeleton" aria-busy="true" />;
  const latest = jobs[0];
  const shownJobs = [
    ...activeJobs,
    ...(latest &&
    !isActiveJob(latest) &&
    ["failed", "cancelled", "budget_stopped"].includes(latest.status)
      ? [latest]
      : []),
  ];
  const stageIndex = stageOrder.indexOf(book.stage);
  return (
    <>
      <header className="kdp-book-header">
        <div className="kdp-book-title">
          <span className="eyebrow">
            <ClipboardCheck size={13} /> {book.penName ?? "No pen name"} ·{" "}
            {book.genre}
            {book.subgenre ? ` / ${book.subgenre}` : ""} ·{" "}
            {languageLabel(book.language)}
          </span>
          <h1>{book.title}</h1>
          {book.subtitle && <p>{book.subtitle}</p>}
        </div>
        <dl className="kdp-book-stats">
          <div>
            <dt>Words</dt>
            <dd>
              {formatWords(book.actualWords)}{" "}
              <small>/ {formatWords(book.brief.targetWords)}</small>
            </dd>
          </div>
          <div>
            <dt>Chapters</dt>
            <dd>
              {book.chaptersDrafted}{" "}
              <small>/ {book.chaptersPlanned || book.brief.chapterCount}</small>
            </dd>
          </div>
          <div>
            <dt>AI spend</dt>
            <dd>{formatUsd(book.spentMicros)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <Pill
                tone={
                  book.status === "ready"
                    ? "good"
                    : book.status === "published"
                      ? "accent"
                      : "neutral"
                }
              >
                {bookStatusLabels[book.status]}
              </Pill>
            </dd>
          </div>
        </dl>
      </header>
      <ol className="kdp-stages" aria-label="Book progress">
        {stageOrder.map((stage, index) => (
          <li
            key={stage}
            className={
              index < stageIndex
                ? "done"
                : index === stageIndex
                  ? "current"
                  : ""
            }
          >
            <span>{stageLabels[stage]}</span>
          </li>
        ))}
      </ol>
      <nav className="kdp-tabs" aria-label="Book sections">
        {tabs.map(({ path, label, icon: Icon }) => {
          const href = `/kdp/books/${bookId}${path}`;
          const active =
            path === "" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={path}
              href={href}
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={15} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      {shownJobs.map((job) => (
        <JobPanel
          key={job.id}
          job={job}
          bookId={bookId}
          workerRunning={workerRunning}
          onChange={() => {
            void refreshJobs();
            void reloadBook();
          }}
        />
      ))}
    </>
  );
}

export default function BookLayout({ children }: { children: ReactNode }) {
  const { bookId } = useParams<{ bookId: string }>();
  return (
    <BookProvider bookId={bookId}>
      <div className="page kdp-page">
        <BookHeader />
        {children}
      </div>
    </BookProvider>
  );
}
