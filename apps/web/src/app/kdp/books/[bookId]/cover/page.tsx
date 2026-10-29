"use client";

import type { CoverAsset } from "@ai-studio/contracts";
import { useCallback, useMemo, useState } from "react";

import { useBook } from "@/components/kdp/book-context";
import { CoverComposer } from "@/components/kdp/publishing/cover-composer";
import { CoverConcepts } from "@/components/kdp/publishing/cover-concepts";
import {
  ArtworkIntake,
  FinishedCoverUpload,
} from "@/components/kdp/publishing/cover-intake";
import { CoverVersions } from "@/components/kdp/publishing/cover-versions";
import {
  StatusLine,
  useAction,
  useReloadOnSettle,
  type CoverRules,
  type CoversResponse,
} from "@/components/kdp/publishing/shared";
import { kdpPath, startJob, useResource } from "@/lib/kdp";

function CoverRulesCard({ rules }: { rules: CoverRules }) {
  const formats = rules.formats
    .map((format) => format.replace("image/", "").toUpperCase())
    .join(" or ");
  return (
    <section
      className="kdp-card kdp-cover-rules"
      aria-labelledby="kdp-cover-rules-title"
    >
      <header>
        <div>
          <h2 id="kdp-cover-rules-title">KDP eBook cover rules</h2>
          <p>
            This studio makes the Kindle eBook cover only. Paperback and
            hardcover covers need a full wrap with spine and are a separate,
            later workflow.
          </p>
        </div>
      </header>
      <dl>
        <div>
          <dt>Ideal size</dt>
          <dd>
            {rules.idealWidth} × {rules.idealHeight} px
          </dd>
        </div>
        <div>
          <dt>Height ÷ width</dt>
          <dd>{rules.ratio} : 1</dd>
        </div>
        <div>
          <dt>Minimum</dt>
          <dd>
            {rules.minWidth} × {rules.minHeight} px
          </dd>
        </div>
        <div>
          <dt>File type</dt>
          <dd>{formats}</dd>
        </div>
        <div>
          <dt>Colour</dt>
          <dd>{rules.colorModel.toUpperCase()}</dd>
        </div>
        <div>
          <dt>File size</dt>
          <dd>up to {rules.maxFileSizeMB} MB</dd>
        </div>
      </dl>
    </section>
  );
}

export default function CoverPage() {
  const { bookId, book, activeJobs, refreshJobs, settledVersion, reloadBook } =
    useBook();
  const resource = useResource<CoversResponse>(kdpPath(bookId, "/covers"));
  useReloadOnSettle(settledVersion, resource.reload);
  const { busy, status, run } = useAction();
  const [artworkId, setArtworkId] = useState<string>();
  const running = activeJobs.some((job) => job.kind === "cover-prompts");
  const data = resource.data;
  const reload = resource.reload;
  const setData = resource.setData;

  const artworks = useMemo(
    () =>
      (data?.items ?? [])
        .filter((item) => item.kind === "artwork")
        .sort((a, b) => b.version - a.version),
    [data?.items],
  );

  const generate = () =>
    run("concepts", async () => {
      await startJob(bookId, { kind: "cover-prompts" });
      await refreshJobs();
      return "Creating cover concepts. They appear here when ready.";
    });

  const onUploaded = useCallback(
    (cover: CoverAsset) => {
      if (cover.kind === "artwork") setArtworkId(cover.id);
      void reload();
      void reloadBook();
    },
    [reload, reloadBook],
  );

  const onChanged = useCallback(
    (cover: CoverAsset, currentChanged: boolean) => {
      if (currentChanged) {
        void reload();
        void reloadBook();
        return;
      }
      setData((current) => ({
        ...current!,
        items: current!.items.map((item) =>
          item.id === cover.id ? cover : item,
        ),
      }));
    },
    [reload, reloadBook, setData],
  );

  const compose = useCallback((id: string) => {
    setArtworkId(id);
    document
      .getElementById("kdp-cover-composer-title")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (!data) {
    return resource.error ? (
      <p className="notice error">{resource.error}</p>
    ) : (
      <p className="kdp-muted" aria-busy="true">
        Loading the cover studio…
      </p>
    );
  }

  return (
    <div className="kdp-cover">
      <CoverRulesCard rules={data.rules} />
      <CoverConcepts
        concepts={data.concepts?.data ?? []}
        createdAt={data.concepts?.createdAt ?? null}
        running={running}
        busy={busy === "concepts"}
        onGenerate={() => void generate()}
      />
      <StatusLine status={status} />
      <div className="kdp-grid-2 kdp-cover-intake">
        <ArtworkIntake bookId={bookId} onUploaded={onUploaded} />
        <FinishedCoverUpload
          bookId={bookId}
          title={book?.title ?? ""}
          author={book?.penName ?? ""}
          onUploaded={onUploaded}
        />
      </div>
      {book && (
        <CoverComposer
          bookId={bookId}
          book={book}
          artworks={artworks}
          artworkId={artworkId}
          onArtworkChange={setArtworkId}
          onSaved={onUploaded}
        />
      )}
      <CoverVersions
        bookId={bookId}
        items={data.items}
        onChanged={onChanged}
        onCompose={compose}
      />
    </div>
  );
}
