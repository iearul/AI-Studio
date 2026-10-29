"use client";

import type { BookMetadataRecord } from "@ai-studio/contracts";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useCallback, useMemo } from "react";

import { useBook } from "@/components/kdp/book-context";
import { DisclosurePanel } from "@/components/kdp/publishing/disclosure-panel";
import { MetadataForm } from "@/components/kdp/publishing/metadata-form";
import {
  StatusLine,
  useAction,
  useReloadOnSettle,
  type ExportsResponse,
  type MetadataResponse,
} from "@/components/kdp/publishing/shared";
import { formatDateTime, kdpPath, startJob, useResource } from "@/lib/kdp";

export default function MetadataPage() {
  const { bookId, book, activeJobs, refreshJobs, settledVersion, reloadBook } =
    useBook();
  const resource = useResource<MetadataResponse>(kdpPath(bookId, "/metadata"));
  const exports = useResource<ExportsResponse>(kdpPath(bookId, "/exports"));
  useReloadOnSettle(settledVersion, resource.reload);
  const { busy, status, run } = useAction();
  const formAction = useAction();
  const running = activeJobs.some((job) => job.kind === "metadata");
  const data = resource.data;
  const reload = resource.reload;
  const setData = resource.setData;

  const epubBytes = useMemo(() => {
    const latest = (exports.data?.items ?? [])
      .filter((item) => item.status === "succeeded")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return latest?.files.find((file) => file.kind === "epub")?.byteSize ?? null;
  }, [exports.data]);

  const generate = () => {
    if (
      data?.record &&
      !window.confirm(
        "Write a new listing with AI? The description, keywords, categories and audience fields are replaced. Your price, KDP Select choice and release plan stay. Unsaved edits are lost.",
      )
    ) {
      return;
    }
    void run("generate", async () => {
      await startJob(bookId, { kind: "metadata" });
      await refreshJobs();
      return "Writing the listing. The form updates when it is ready.";
    });
  };

  const onSaved = useCallback(
    (record: BookMetadataRecord) => {
      setData((current) => ({ ...current!, record }));
      void reload();
      void reloadBook();
    },
    [reload, reloadBook, setData],
  );

  const onApprovalChanged = useCallback(() => {
    void reloadBook();
    void reload();
  }, [reload, reloadBook]);

  const suggestion = data?.suggestion;

  return (
    <div className="kdp-meta">
      <section className="kdp-card">
        <header>
          <div>
            <h2>Amazon KDP listing</h2>
            <p>
              Everything you enter on KDP’s Book Details and Pricing pages.
              Check every field; you publish it yourself on kdp.amazon.com.
            </p>
            {data?.record?.generatedAt && (
              <p>
                Last written with AI {formatDateTime(data.record.generatedAt)}.
              </p>
            )}
          </div>
          <button
            type="button"
            className={data?.record ? "button secondary" : "button primary"}
            disabled={running || !!busy}
            onClick={generate}
          >
            {running || busy === "generate" ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Sparkles size={15} />
            )}
            {running
              ? "Writing listing…"
              : data?.record
                ? "Rewrite with AI"
                : "Write listing with AI"}
          </button>
        </header>
        {suggestion && (
          <details className="kdp-details">
            <summary>Why the AI suggested this</summary>
            <div className="kdp-meta-suggestion">
              {suggestion.data.subtitle && (
                <p>
                  <strong>Subtitle idea:</strong> {suggestion.data.subtitle}
                </p>
              )}
              <p>
                <strong>Subtitle:</strong> {suggestion.data.subtitleRationale}
              </p>
              <p>
                <strong>Audience:</strong> {suggestion.data.audience}
              </p>
              <p>
                <strong>Price:</strong>{" "}
                {suggestion.data.suggestedPriceUsd.toFixed(2)} USD.{" "}
                {suggestion.data.pricingRationale}
              </p>
              <p className="kdp-muted">
                Suggested {formatDateTime(suggestion.createdAt)}.
              </p>
            </div>
          </details>
        )}
        <StatusLine status={status} />
      </section>

      {resource.error && !data && (
        <p className="notice error">{resource.error}</p>
      )}
      {!data && !resource.error && (
        <p className="kdp-muted" aria-busy="true">
          Loading the listing…
        </p>
      )}
      {data && book && (
        <MetadataForm
          key={data.record?.updatedAt ?? "new"}
          bookId={bookId}
          book={book}
          response={data}
          epubBytes={epubBytes}
          action={formAction}
          onSaved={onSaved}
          onApprovalChanged={onApprovalChanged}
        />
      )}

      <DisclosurePanel bookId={bookId} settledVersion={settledVersion} />
    </div>
  );
}
