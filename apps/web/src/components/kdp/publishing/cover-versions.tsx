"use client";

import type { CoverAsset, ProvenanceClass } from "@ai-film-studio/contracts";
import {
  BookImage,
  CheckCircle2,
  LoaderCircle,
  Maximize2,
  Wand2,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { useLightbox } from "@/components/image-lightbox";
import { EmptyPanel, Pill } from "@/components/kdp/kdp-ui";
import { formatBytes } from "@/lib/api";
import { coverUrl, formatDateTime, kdpPath, kdpSend } from "@/lib/kdp";

import {
  imageProvenanceOptions,
  provenanceLabels,
  provenanceTone,
  StatusLine,
  useAction,
} from "./shared";

const sourceLabels: Record<CoverAsset["source"], string> = {
  upload: "Uploaded",
  paste: "Pasted",
  drop: "Dropped",
  composite: "Made in the composer",
};

const colorLabels: Record<string, string> = {
  rgb: "RGB",
  cmyk: "CMYK",
  grayscale: "Grayscale",
};

function VersionCard({
  bookId,
  cover,
  onOpen,
  onChanged,
  onCompose,
}: {
  bookId: string;
  cover: CoverAsset;
  onOpen: () => void;
  onChanged: (cover: CoverAsset, currentChanged: boolean) => void;
  onCompose: (id: string) => void;
}) {
  const { busy, status, run } = useAction();
  const [provenance, setProvenance] = useState<ProvenanceClass>(
    cover.provenance,
  );
  const [note, setNote] = useState(cover.provenanceNote ?? "");
  const canBeCurrent =
    cover.kind === "final" && cover.validation.ok && !cover.isCurrent;
  const provenanceChanged =
    provenance !== cover.provenance ||
    note.trim() !== (cover.provenanceNote ?? "");

  const makeCurrent = () =>
    run("current", async () => {
      const updated = await kdpSend<CoverAsset>(
        kdpPath(bookId, `/covers/${cover.id}/current`),
        "POST",
      );
      onChanged(updated, true);
      return `Version ${cover.version} is now the book cover.`;
    });

  const saveProvenance = () =>
    run("provenance", async () => {
      const updated = await kdpSend<CoverAsset>(
        kdpPath(bookId, `/covers/${cover.id}`),
        "PATCH",
        {
          provenance,
          provenanceNote: note.trim() || null,
        },
      );
      onChanged(updated, false);
      return "Classification saved.";
    });

  const label = `Cover version ${cover.version} (${cover.kind === "final" ? "final cover" : "artwork"})`;
  const options = imageProvenanceOptions.includes(cover.provenance)
    ? imageProvenanceOptions
    : [cover.provenance, ...imageProvenanceOptions];

  return (
    <article
      className={`kdp-cover-version ${cover.isCurrent ? "current" : ""}`}
    >
      <button
        type="button"
        className="kdp-cover-thumb"
        onClick={onOpen}
        aria-label={`View ${label} full size`}
      >
        <Image
          unoptimized
          fill
          sizes="180px"
          src={coverUrl(bookId, cover.id)}
          alt=""
        />
        <span className="kdp-cover-zoom" aria-hidden="true">
          <Maximize2 size={13} />
        </span>
      </button>
      <div className="kdp-cover-version-body">
        <div className="kdp-cover-version-head">
          <strong>Version {cover.version}</strong>
          <Pill tone={cover.kind === "final" ? "accent" : "neutral"}>
            {cover.kind === "final" ? "Final cover" : "Artwork"}
          </Pill>
          {cover.isCurrent && (
            <Pill tone="good">
              <CheckCircle2 size={12} aria-hidden="true" /> Book cover
            </Pill>
          )}
        </div>
        <dl className="kdp-cover-version-facts">
          <div>
            <dt>Source</dt>
            <dd>{sourceLabels[cover.source]}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>
              {cover.width ?? "?"} × {cover.height ?? "?"} px ·{" "}
              {formatBytes(cover.byteSize)}
            </dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>
              {cover.mimeType.replace("image/", "").toUpperCase()} ·{" "}
              {colorLabels[cover.colorModel] ?? cover.colorModel}
            </dd>
          </div>
          <div>
            <dt>Made by</dt>
            <dd>
              <Pill tone={provenanceTone(cover.provenance)}>
                {provenanceLabels[cover.provenance]}
              </Pill>
              {cover.provenanceNote && <small> {cover.provenanceNote}</small>}
            </dd>
          </div>
          <div>
            <dt>Added</dt>
            <dd>{formatDateTime(cover.createdAt)}</dd>
          </div>
        </dl>
        {cover.validation.errors.length > 0 && (
          <ul className="kdp-cover-validation bad" aria-label="Problems">
            {cover.validation.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        {cover.validation.warnings.length > 0 && (
          <ul className="kdp-cover-validation warn" aria-label="Warnings">
            {cover.validation.warnings.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        {cover.kind === "final" &&
          cover.validation.ok &&
          cover.validation.warnings.length === 0 && (
            <p className="kdp-cover-valid">Meets the KDP eBook cover rules.</p>
          )}
        <div className="kdp-actions">
          {canBeCurrent && (
            <button
              type="button"
              className="button primary small"
              disabled={!!busy}
              onClick={() => void makeCurrent()}
            >
              {busy === "current" ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <BookImage size={13} />
              )}
              Use as book cover
            </button>
          )}
          {cover.kind === "artwork" && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => onCompose(cover.id)}
            >
              <Wand2 size={13} /> Compose with this
            </button>
          )}
        </div>
        <details className="kdp-cover-edit">
          <summary>Change who made it</summary>
          <div>
            <label className="field">
              <span>Made by</span>
              <select
                value={provenance}
                onChange={(event) =>
                  setProvenance(event.target.value as ProvenanceClass)
                }
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {provenanceLabels[option]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Note</span>
              <input
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button secondary small"
              disabled={!provenanceChanged || !!busy}
              onClick={() => void saveProvenance()}
            >
              {busy === "provenance" && (
                <LoaderCircle size={13} className="spin" />
              )}
              Save
            </button>
          </div>
        </details>
        <StatusLine status={status} />
      </div>
    </article>
  );
}

export function CoverVersions({
  bookId,
  items,
  onChanged,
  onCompose,
}: {
  bookId: string;
  items: CoverAsset[];
  onChanged: (cover: CoverAsset, currentChanged: boolean) => void;
  onCompose: (id: string) => void;
}) {
  const lightbox = useLightbox();
  const sorted = [...items].sort((a, b) => b.version - a.version);
  const images = sorted.map((cover) => ({
    src: coverUrl(bookId, cover.id),
    alt: `Cover version ${cover.version}`,
    caption: `Version ${cover.version} · ${cover.kind === "final" ? "Final cover" : "Artwork"} · ${cover.width ?? "?"} × ${cover.height ?? "?"} px`,
  }));
  return (
    <section className="kdp-card">
      <header>
        <div>
          <h2>Versions</h2>
          <p>
            Every image you add is kept. Only a final cover that passes the KDP
            checks can be the book cover.
          </p>
        </div>
      </header>
      {sorted.length === 0 ? (
        <EmptyPanel icon={<BookImage size={22} />} title="No images yet">
          Add artwork or upload a finished cover to start.
        </EmptyPanel>
      ) : (
        <div className="kdp-cover-versions">
          {sorted.map((cover, index) => (
            <VersionCard
              key={cover.id}
              bookId={bookId}
              cover={cover}
              onOpen={() => lightbox.open(images, index)}
              onChanged={onChanged}
              onCompose={onCompose}
            />
          ))}
        </div>
      )}
      {lightbox.element}
    </section>
  );
}
