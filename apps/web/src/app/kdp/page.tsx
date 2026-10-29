"use client";

import type {
  AuthorProfile,
  BookStatus,
  BookSummary,
} from "@ai-film-studio/contracts";
import { bookStatuses } from "@ai-film-studio/contracts";
import {
  BookPlus,
  LayoutGrid,
  LibraryBig,
  List,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyPanel } from "@/components/kdp/kdp-ui";
import {
  BookCard,
  BookRow,
  type BookAction,
} from "@/components/kdp/library/book-card";
import { ConfirmDialog } from "@/components/kdp/library/confirm-dialog";
import { ApiError, apiFetch } from "@/lib/api";
import {
  bookStatusLabels,
  errorMessage,
  kdpDelete,
  kdpSend,
  useResource,
} from "@/lib/kdp";

type ViewMode = "grid" | "list";
type SortKey = "updated" | "created" | "title" | "words" | "status";
type StatusFilter = "active" | "all" | BookStatus;
type Notice = {
  tone: "success" | "error";
  text: string;
  href?: string;
  linkLabel?: string;
  undo?: () => void;
};

const viewStorageKey = "kdp-library-view";

const sortLabels: Record<SortKey, string> = {
  updated: "Last updated",
  created: "Newest first",
  title: "Title A–Z",
  words: "Most words",
  status: "Status",
};

/** Loads the filtered list and keeps showing the last result while it reloads. */
function useBookList(path: string) {
  const [state, setState] = useState<{
    items: BookSummary[] | undefined;
    error: string | undefined;
    loading: boolean;
  }>({ items: undefined, error: undefined, loading: true });
  const latest = useRef(path);
  useEffect(() => {
    latest.current = path;
  }, [path]);

  const reload = useCallback(async () => {
    try {
      const result = await apiFetch<{ items: BookSummary[] }>(path);
      if (latest.current !== path) return;
      setState({ items: result.items, error: undefined, loading: false });
    } catch (reason) {
      if (latest.current !== path) return;
      setState((current) => ({
        ...current,
        error: errorMessage(reason),
        loading: false,
      }));
    }
  }, [path]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, loading: true }));
      void reload();
    }, 0);
    return () => clearTimeout(timer);
  }, [reload]);

  // Refresh progress while a book has a background job running.
  const hasActive = state.items?.some((book) => book.activeJob) ?? false;
  useEffect(() => {
    if (!hasActive) return;
    const interval = setInterval(() => void reload(), 4_000);
    return () => clearInterval(interval);
  }, [hasActive, reload]);

  return { ...state, reload };
}

function uniqueSorted(values: (string | null)[]): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => !!value?.trim())),
  ).sort((a, b) => a.localeCompare(b));
}

export default function KdpLibraryPage() {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [authorId, setAuthorId] = useState("");
  const [genre, setGenre] = useState("");
  const [series, setSeries] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [busy, setBusy] = useState<{ id: string; action: BookAction }>();
  const [notice, setNotice] = useState<Notice>();
  const [confirmDelete, setConfirmDelete] = useState<BookSummary>();

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(viewStorageKey);
        if (stored === "grid" || stored === "list") setView(stored);
      } catch {
        // Storage can be unavailable (private mode); the grid is the default.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(viewStorageKey, next);
    } catch {
      // Not remembered; the choice still applies for this visit.
    }
  };

  const params = new URLSearchParams();
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (!showDeleted && status !== "active" && status !== "all") {
    params.set("status", status);
  }
  if (authorId) params.set("authorProfileId", authorId);
  if (genre) params.set("genre", genre);
  if (series) params.set("series", series);
  params.set("sort", sort);
  if (showDeleted) params.set("includeDeleted", "true");

  const list = useBookList(`/kdp/books?${params.toString()}`);
  const facets = useResource<{ items: BookSummary[] }>("/kdp/books?sort=title");
  const authors = useResource<{ items: AuthorProfile[] }>("/kdp/authors");

  const allBooks = facets.data?.items;
  const genres = uniqueSorted(
    (allBooks ?? []).flatMap((book) => [book.genre, book.subgenre]),
  );
  const seriesNames = uniqueSorted(
    (allBooks ?? []).map((book) => book.seriesName),
  );

  const hideArchived = !showDeleted && status === "active";
  const items = list.items ?? [];
  const shown = hideArchived
    ? items.filter((book) => book.status !== "archived")
    : items;
  const hiddenArchived = items.length - shown.length;
  const filtersActive =
    !!debouncedSearch ||
    !!authorId ||
    !!genre ||
    !!series ||
    (status !== "active" && !showDeleted);
  const libraryEmpty = !!allBooks && allBooks.length === 0;

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setAuthorId("");
    setGenre("");
    setSeries("");
    setStatus("active");
  };

  const refreshAll = () => {
    void list.reload();
    void facets.reload();
  };

  const restore = async (book: BookSummary) => {
    await kdpSend<BookSummary>(`/kdp/books/${book.id}/restore`, "POST");
    setNotice({ tone: "success", text: `Restored “${book.title}”.` });
  };

  const run = async (
    book: BookSummary,
    action: BookAction,
    task: () => Promise<void>,
  ) => {
    setBusy({ id: book.id, action });
    setNotice(undefined);
    try {
      await task();
      refreshAll();
    } catch (reason) {
      setNotice({ tone: "error", text: errorMessage(reason) });
    } finally {
      setBusy(undefined);
    }
  };

  const onAction = (book: BookSummary, action: BookAction) => {
    switch (action) {
      case "delete":
        setConfirmDelete(book);
        return;
      case "restore":
        void run(book, action, () => restore(book));
        return;
      case "duplicate":
        void run(book, action, async () => {
          const copy = await kdpSend<BookSummary>(
            `/kdp/books/${book.id}/duplicate`,
            "POST",
          );
          setNotice({
            tone: "success",
            text: `Created “${copy.title}”.`,
            href: `/kdp/books/${copy.id}`,
            linkLabel: "Open copy",
          });
        });
        return;
      case "archive": {
        const archiving = book.status !== "archived";
        void run(book, action, async () => {
          await kdpSend<BookSummary>(`/kdp/books/${book.id}`, "PATCH", {
            status: archiving ? "archived" : "draft",
          });
          setNotice({
            tone: "success",
            text: archiving
              ? `Archived “${book.title}”.`
              : `“${book.title}” is back in your library.`,
          });
        });
        return;
      }
      case "export":
        void run(book, action, async () => {
          try {
            await kdpSend(`/kdp/books/${book.id}/exports`, "POST");
          } catch (reason) {
            // 422: the export ran but failed checks; the publish page lists why.
            if (!(reason instanceof ApiError && reason.status === 422)) {
              throw reason;
            }
          }
          router.push(`/kdp/books/${book.id}/publish`);
        });
        return;
    }
  };

  const deleteBook = async (book: BookSummary) => {
    setBusy({ id: book.id, action: "delete" });
    setNotice(undefined);
    try {
      await kdpDelete(`/kdp/books/${book.id}`);
      setConfirmDelete(undefined);
      setNotice({
        tone: "success",
        text: `Moved “${book.title}” to Recently deleted.`,
        undo: () => void run(book, "restore", () => restore(book)),
      });
      refreshAll();
    } catch (reason) {
      setConfirmDelete(undefined);
      setNotice({ tone: "error", text: errorMessage(reason) });
    } finally {
      setBusy(undefined);
    }
  };

  const countText = () => {
    if (!list.items) return "";
    const noun = shown.length === 1 ? "book" : "books";
    if (showDeleted) return `${shown.length} deleted ${noun}`;
    return `${shown.length} ${noun}`;
  };

  return (
    <div className="page kdp-page kdp-lib-page">
      <header className="page-heading compact">
        <div>
          <span className="eyebrow">
            <LibraryBig size={14} /> KDP Story Studio
          </span>
          <h1>My books</h1>
          <p>Every draft, series and published title in one library.</p>
        </div>
        <Link className="button primary" href="/kdp/new">
          <Plus size={17} /> New story
        </Link>
      </header>

      <div className="kdp-lib-toolbar">
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, series or pen name…"
            aria-label="Search books"
          />
        </label>
        <div className="kdp-lib-toolbar-end">
          <label className="kdp-lib-select">
            <span>Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
            >
              {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {sortLabels[key]}
                </option>
              ))}
            </select>
          </label>
          <div
            className="segmented kdp-lib-view"
            role="group"
            aria-label="Layout"
          >
            <button
              type="button"
              className={view === "grid" ? "selected" : ""}
              aria-pressed={view === "grid"}
              onClick={() => changeView("grid")}
            >
              <LayoutGrid size={14} aria-hidden="true" /> Grid
            </button>
            <button
              type="button"
              className={view === "list" ? "selected" : ""}
              aria-pressed={view === "list"}
              onClick={() => changeView("list")}
            >
              <List size={14} aria-hidden="true" /> List
            </button>
          </div>
        </div>
      </div>

      <div className="kdp-lib-filters" role="group" aria-label="Filters">
        <label className="kdp-lib-select">
          <span>Pen name</span>
          <select
            value={authorId}
            onChange={(event) => setAuthorId(event.target.value)}
          >
            <option value="">All</option>
            {(authors.data?.items ?? []).map((author) => (
              <option key={author.id} value={author.id}>
                {author.penName}
              </option>
            ))}
          </select>
        </label>
        <label className="kdp-lib-select">
          <span>Genre</span>
          <select
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
          >
            <option value="">All</option>
            {genres.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="kdp-lib-select">
          <span>Series</span>
          <select
            value={series}
            onChange={(event) => setSeries(event.target.value)}
            disabled={seriesNames.length === 0}
          >
            <option value="">All</option>
            {seriesNames.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="kdp-lib-select">
          <span>Status</span>
          <select
            value={status}
            disabled={showDeleted}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            <option value="active">All except archived</option>
            <option value="all">All, including archived</option>
            {bookStatuses.map((value) => (
              <option key={value} value={value}>
                {bookStatusLabels[value]}
              </option>
            ))}
          </select>
        </label>
        {filtersActive && (
          <button
            type="button"
            className="button ghost small"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
        <button
          type="button"
          className={`button small kdp-lib-deleted-toggle${showDeleted ? " active" : " ghost"}`}
          aria-pressed={showDeleted}
          onClick={() => setShowDeleted((value) => !value)}
        >
          <Trash2 size={14} aria-hidden="true" />
          {showDeleted ? "Back to library" : "Recently deleted"}
        </button>
      </div>

      <div className="kdp-lib-live" role="status" aria-live="polite">
        {notice && (
          <div className={`notice ${notice.tone} kdp-lib-notice`}>
            <span>{notice.text}</span>
            {notice.href && (
              <Link className="button ghost small" href={notice.href}>
                {notice.linkLabel ?? "Open"}
              </Link>
            )}
            {notice.undo && (
              <button
                type="button"
                className="button ghost small"
                onClick={notice.undo}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              className="kdp-lib-dismiss"
              onClick={() => setNotice(undefined)}
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {showDeleted && (
        <p className="kdp-lib-hint">
          Deleted books stay here until you restore them.
        </p>
      )}

      {list.error && (
        <div className="notice error kdp-lib-notice" role="alert">
          <span>{list.error}</span>
          <button
            type="button"
            className="button ghost small"
            onClick={() => void list.reload()}
          >
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}

      {list.items && (shown.length > 0 || hiddenArchived > 0) && (
        <p className="kdp-lib-count" aria-live="polite">
          {countText()}
          {list.loading && " · updating…"}
          {hiddenArchived > 0 && (
            <>
              {` · ${hiddenArchived} archived hidden `}
              <button
                type="button"
                className="kdp-lib-linkbutton"
                onClick={() => setStatus("all")}
              >
                Show
              </button>
            </>
          )}
        </p>
      )}

      {!list.items && !list.error ? (
        <div
          className="kdp-lib-grid"
          aria-busy="true"
          aria-label="Loading books"
        >
          <div className="kdp-lib-skeleton" />
          <div className="kdp-lib-skeleton" />
          <div className="kdp-lib-skeleton" />
        </div>
      ) : list.items && shown.length === 0 ? (
        showDeleted ? (
          <EmptyPanel
            icon={<Trash2 size={22} />}
            title="Nothing recently deleted"
          >
            Books you delete appear here, so you can restore them.
          </EmptyPanel>
        ) : libraryEmpty && !filtersActive ? (
          <EmptyPanel
            icon={<BookPlus size={22} />}
            title="No books yet"
            action={
              <Link className="button primary" href="/kdp/new">
                <Plus size={16} /> Create new story
              </Link>
            }
          >
            Start with an idea. The wizard sets up genre, length, style and pen
            name in a few steps.
          </EmptyPanel>
        ) : (
          <EmptyPanel
            icon={<SearchX size={22} />}
            title="No books match"
            action={
              <button
                type="button"
                className="button secondary"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            }
          >
            {hiddenArchived > 0
              ? "Only archived books match. Show archived books or clear the filters."
              : "Try a broader search or remove a filter."}
          </EmptyPanel>
        )
      ) : list.items ? (
        <div className={view === "grid" ? "kdp-lib-grid" : "kdp-lib-list"}>
          {shown.map((book) => {
            const props = {
              book,
              deleted: showDeleted,
              busy: busy?.id === book.id ? busy.action : undefined,
              disabled: !!busy,
              onAction,
            };
            return view === "grid" ? (
              <BookCard key={book.id} {...props} />
            ) : (
              <BookRow key={book.id} {...props} />
            );
          })}
        </div>
      ) : null}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${confirmDelete.title}”?`}
          confirmLabel="Delete book"
          busy={busy?.action === "delete"}
          onCancel={() => setConfirmDelete(undefined)}
          onConfirm={() => void deleteBook(confirmDelete)}
        >
          <p>
            The book moves to Recently deleted. You can restore it from there at
            any time.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
