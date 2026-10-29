"use client";

import type { BookSummary, KdpJob } from "@ai-film-studio/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { kdpPath, useBookJobs, useResource } from "@/lib/kdp";

type BookContextValue = {
  bookId: string;
  book: BookSummary | undefined;
  error: string | undefined;
  reloadBook: () => Promise<void>;
  jobs: KdpJob[];
  activeJobs: KdpJob[];
  workerRunning: boolean;
  refreshJobs: () => Promise<void>;
  /** Increments whenever a job finishes; pages reload their data on change. */
  settledVersion: number;
};

const BookContext = createContext<BookContextValue | undefined>(undefined);

export function BookProvider({
  bookId,
  children,
}: {
  bookId: string;
  children: ReactNode;
}) {
  const book = useResource<BookSummary>(kdpPath(bookId));
  const [settledVersion, setSettledVersion] = useState(0);
  const reloadBook = book.reload;
  const onSettled = useCallback(() => {
    setSettledVersion((value) => value + 1);
    void reloadBook();
  }, [reloadBook]);
  const jobs = useBookJobs(bookId, onSettled);
  // Word counts and spend change while a job runs.
  const running = jobs.active.length > 0;
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => void reloadBook(), 5_000);
    return () => clearInterval(interval);
  }, [running, reloadBook]);
  return (
    <BookContext.Provider
      value={{
        bookId,
        book: book.data,
        error: book.error,
        reloadBook,
        jobs: jobs.jobs,
        activeJobs: jobs.active,
        workerRunning: jobs.workerRunning,
        refreshJobs: jobs.refresh,
        settledVersion,
      }}
    >
      {children}
    </BookContext.Provider>
  );
}

export function useBook(): BookContextValue {
  const value = useContext(BookContext);
  if (!value) throw new Error("useBook must be used inside a book page.");
  return value;
}
