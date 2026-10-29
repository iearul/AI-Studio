"use client";

import type { BookSummary } from "@ai-film-studio/contracts";
import Image from "next/image";

import { coverUrl } from "@/lib/kdp";

const placeholderTones = ["ink", "plum", "moss", "rust", "slate", "wine"];

function toneFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return placeholderTones[hash % placeholderTones.length] ?? "ink";
}

/**
 * The current cover, or a typographic stand-in so a library of unfinished
 * books still reads as a shelf.
 */
export function BookCover({
  book,
  compact = false,
}: {
  book: Pick<BookSummary, "id" | "title" | "penName" | "coverThumbnail">;
  compact?: boolean;
}) {
  const size = compact ? " compact" : "";
  if (book.coverThumbnail) {
    return (
      <span className={`kdp-lib-cover${size}`}>
        <Image
          unoptimized
          fill
          sizes={compact ? "48px" : "120px"}
          src={coverUrl(book.id, book.coverThumbnail)}
          alt=""
        />
      </span>
    );
  }
  const initial = Array.from(book.title.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span
      className={`kdp-lib-cover placeholder ${toneFor(book.id)}${size}`}
      aria-hidden="true"
    >
      <span className="kdp-lib-cover-initial">{initial}</span>
      {!compact && (
        <span className="kdp-lib-cover-text">
          <span className="kdp-lib-cover-title">{book.title}</span>
          {book.penName && (
            <span className="kdp-lib-cover-author">{book.penName}</span>
          )}
        </span>
      )}
    </span>
  );
}
