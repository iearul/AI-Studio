"use client";

import type {
  BookSummary,
  CoverUploadFields,
  KdpJob,
  StartKdpJob,
} from "@ai-film-studio/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiBaseUrl, apiFetch } from "@/lib/api";

export const kdpPath = (bookId: string, rest = "") =>
  `/kdp/books/${bookId}${rest}`;

export function kdpSend<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** DELETE returns 204 without a body, which apiFetch cannot parse. */
export async function kdpDelete(path: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}${path}`, { method: "DELETE" });
  if (!response.ok) {
    const problem = (await response.json().catch(() => undefined)) as
      { detail?: string } | undefined;
    throw new ApiError(
      problem?.detail ?? `Request failed with status ${response.status}.`,
      response.status,
    );
  }
}

export function errorMessage(
  reason: unknown,
  fallback = "Something went wrong.",
): string {
  if (reason instanceof ApiError && reason.problem?.errors) {
    return Object.entries(reason.problem.errors)
      .map(([field, messages]) => `${field}: ${messages.join(" ")}`)
      .join(" ");
  }
  return reason instanceof Error ? reason.message : fallback;
}

export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Starts a background job. The idempotency key is created once per click, so
 * a double click or a retried request returns the same job.
 */
export function startJob(
  bookId: string,
  input: Omit<StartKdpJob, "idempotencyKey">,
): Promise<{ job: KdpJob; created: boolean }> {
  return kdpSend(kdpPath(bookId, "/jobs"), "POST", {
    ...input,
    idempotencyKey: newIdempotencyKey(),
  });
}

export async function uploadCover(
  bookId: string,
  file: Blob,
  filename: string,
  fields: CoverUploadFields,
): Promise<import("@ai-film-studio/contracts").CoverAsset> {
  const params = new URLSearchParams({
    kind: fields.kind,
    source: fields.source,
    provenance: fields.provenance,
  });
  if (fields.provenanceNote)
    params.set("provenanceNote", fields.provenanceNote);
  if (fields.parentId) params.set("parentId", fields.parentId);
  if (fields.settings) params.set("settings", JSON.stringify(fields.settings));
  const form = new FormData();
  form.append("file", file, filename);
  return apiFetch(`${kdpPath(bookId, "/covers")}?${params.toString()}`, {
    method: "POST",
    body: form,
  });
}

export const coverUrl = (bookId: string, coverId: string) =>
  `${apiBaseUrl}${kdpPath(bookId, `/covers/${coverId}/file`)}`;

export const exportFileUrl = (
  bookId: string,
  exportId: string,
  filename: string,
) =>
  `${apiBaseUrl}${kdpPath(bookId, `/exports/${exportId}/files/${filename}`)}`;

export const chapterExportUrl = (
  bookId: string,
  chapterId: string,
  format: "md" | "docx",
) =>
  `${apiBaseUrl}${kdpPath(bookId, `/chapters/${chapterId}/export?format=${format}`)}`;

export type Resource<T> = {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (value: T | ((current: T | undefined) => T)) => void;
};

type ResourceState<T> = {
  path: string | null;
  data: T | undefined;
  error: string | undefined;
  loaded: boolean;
};

/** Loads a JSON resource and keeps it fresh on demand. */
export function useResource<T>(path: string | null): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>({
    path,
    data: undefined,
    error: undefined,
    loaded: false,
  });
  const latest = useRef(path);
  useEffect(() => {
    latest.current = path;
  }, [path]);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const value = await apiFetch<T>(path);
      if (latest.current !== path) return;
      setState({ path, data: value, error: undefined, loaded: true });
    } catch (reason) {
      if (latest.current !== path) return;
      setState((current) => ({
        path,
        data: current.path === path ? current.data : undefined,
        error: errorMessage(reason),
        loaded: true,
      }));
    }
  }, [path]);

  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);

  const setData = useCallback((value: T | ((current: T | undefined) => T)) => {
    setState((current) => ({
      ...current,
      data:
        typeof value === "function"
          ? (value as (current: T | undefined) => T)(current.data)
          : value,
    }));
  }, []);

  const current = state.path === path;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: path !== null && !(current && state.loaded),
    reload,
    setData,
  };
}

const activeStatuses = new Set(["queued", "running"]);
export const isActiveJob = (job: Pick<KdpJob, "status"> | null | undefined) =>
  !!job && activeStatuses.has(job.status);

/**
 * Polls the book's jobs while one is active and calls `onSettled` when a job
 * finishes, so pages refresh their data without the user reloading.
 */
export function useBookJobs(bookId: string, onSettled?: (job: KdpJob) => void) {
  const [jobs, setJobs] = useState<KdpJob[]>([]);
  const [workerRunning, setWorkerRunning] = useState(true);
  const previous = useRef(new Map<string, string>());
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);

  const refresh = useCallback(async () => {
    try {
      const result = await apiFetch<{
        items: KdpJob[];
        worker: { running: boolean };
      }>(kdpPath(bookId, "/jobs"));
      setJobs(result.items);
      setWorkerRunning(result.worker.running);
      for (const job of result.items) {
        const before = previous.current.get(job.id);
        if (
          before &&
          activeStatuses.has(before) &&
          !activeStatuses.has(job.status)
        )
          settled.current?.(job);
        previous.current.set(job.id, job.status);
      }
    } catch {
      // A missed poll is retried on the next tick.
    }
  }, [bookId]);

  const hasActive = jobs.some(isActiveJob);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const interval = setInterval(
      () => void refresh(),
      hasActive ? 2_000 : 15_000,
    );
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [refresh, hasActive]);

  return { jobs, refresh, workerRunning, active: jobs.filter(isActiveJob) };
}

export function formatWords(words: number): string {
  return words.toLocaleString("en-US");
}

export function formatUsd(micros: number): string {
  const dollars = micros / 1_000_000;
  return `$${dollars < 0.1 && dollars > 0 ? dollars.toFixed(3) : dollars.toFixed(2)}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const jobKindLabels: Record<KdpJob["kind"], string> = {
  concepts: "Story concepts",
  bible: "Story bible",
  architecture: "Plot architecture",
  outline: "Chapter outline",
  draft: "Manuscript drafting",
  editorial: "Editorial review",
  metadata: "KDP listing",
  "cover-prompts": "Cover concepts",
};

export const jobStatusLabels: Record<KdpJob["status"], string> = {
  queued: "Waiting to start",
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
  budget_stopped: "Stopped at budget",
};

export const bookStatusLabels: Record<BookSummary["status"], string> = {
  draft: "Draft",
  ready: "Ready for KDP",
  published: "Published",
  archived: "Archived",
};

export const stageLabels: Record<BookSummary["stage"], string> = {
  brief: "Brief",
  concepts: "Concepts",
  bible: "Story bible",
  outline: "Outline",
  drafting: "Drafting",
  editing: "Editing",
  publishing: "Publishing",
};

export const languageOptions = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "hi", label: "Hindi" },
];

export function languageLabel(code: string): string {
  return languageOptions.find((option) => option.code === code)?.label ?? code;
}
