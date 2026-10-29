"use client";

import type {
  BookExport,
  BookReadiness,
  PublicationRecord,
} from "@ai-film-studio/contracts";
import { Info } from "lucide-react";
import { useCallback, useMemo } from "react";

import { useBook } from "@/components/kdp/book-context";
import { ExportPanel } from "@/components/kdp/publishing/export-panel";
import { PublicationRecordForm } from "@/components/kdp/publishing/publication-record";
import { PublishingAssistant } from "@/components/kdp/publishing/publishing-assistant";
import { ReadinessPanel } from "@/components/kdp/publishing/readiness-panel";
import {
  useReloadOnSettle,
  type CoversResponse,
  type ExportsResponse,
  type MetadataResponse,
  type ProvenanceResponse,
} from "@/components/kdp/publishing/shared";
import { kdpPath, useResource } from "@/lib/kdp";

export default function PublishPage() {
  const { bookId, settledVersion, reloadBook } = useBook();
  const readiness = useResource<BookReadiness>(kdpPath(bookId, "/readiness"));
  const exports = useResource<ExportsResponse>(kdpPath(bookId, "/exports"));
  const metadata = useResource<MetadataResponse>(kdpPath(bookId, "/metadata"));
  const provenance = useResource<ProvenanceResponse>(
    kdpPath(bookId, "/provenance"),
  );
  const covers = useResource<CoversResponse>(kdpPath(bookId, "/covers"));
  const publication = useResource<PublicationRecord>(
    kdpPath(bookId, "/publication"),
  );
  useReloadOnSettle(settledVersion, readiness.reload);
  useReloadOnSettle(settledVersion, metadata.reload);
  useReloadOnSettle(settledVersion, provenance.reload);
  useReloadOnSettle(settledVersion, covers.reload);

  const reloadReadiness = readiness.reload;
  const setReadiness = readiness.setData;
  const setExports = exports.setData;
  const setPublication = publication.setData;

  const latestExport = useMemo(
    () =>
      [...(exports.data?.items ?? [])]
        .filter((item) => item.status === "succeeded")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    [exports.data],
  );
  const currentCover = covers.data?.items.find((item) => item.isCurrent);

  const onBuilt = useCallback(
    (item: BookExport) => {
      setExports((current) => ({
        items: [
          item,
          ...(current?.items ?? []).filter(
            (existing) => existing.id !== item.id,
          ),
        ],
      }));
      void reloadReadiness();
      void reloadBook();
    },
    [reloadBook, reloadReadiness, setExports],
  );

  const onReadiness = useCallback(
    (value: BookReadiness) => {
      setReadiness(value);
      void reloadBook();
    },
    [reloadBook, setReadiness],
  );

  const onPublication = useCallback(
    (record: PublicationRecord) => {
      setPublication(record);
      void reloadBook();
    },
    [reloadBook, setPublication],
  );

  return (
    <div className="kdp-pub">
      <div className="kdp-pub-intro" role="note">
        <Info size={18} aria-hidden="true" />
        <p>
          <strong>You publish on kdp.amazon.com yourself.</strong> This page
          prepares the files and every value KDP asks for. The studio never
          signs in to Amazon and never asks for your Amazon password.
        </p>
      </div>

      {readiness.error && !readiness.data && (
        <p className="notice error">{readiness.error}</p>
      )}
      {readiness.data ? (
        <ReadinessPanel
          bookId={bookId}
          readiness={readiness.data}
          onChange={onReadiness}
        />
      ) : (
        !readiness.error && (
          <p className="kdp-muted" aria-busy="true">
            Checking readiness…
          </p>
        )
      )}

      <ExportPanel
        bookId={bookId}
        items={exports.data?.items}
        onBuilt={onBuilt}
      />

      <PublishingAssistant
        bookId={bookId}
        metadata={metadata.data}
        provenance={provenance.data}
        latestExport={latestExport}
        currentCover={currentCover}
      />

      {publication.error && !publication.data && (
        <p className="notice error">{publication.error}</p>
      )}
      {publication.data && (
        <PublicationRecordForm
          key={bookId}
          bookId={bookId}
          record={publication.data}
          onSaved={onPublication}
        />
      )}
    </div>
  );
}
