"use client";

import type { BookExport, ExportFile } from "@ai-studio/contracts";
import {
  Download,
  FileArchive,
  LoaderCircle,
  PackageCheck,
} from "lucide-react";

import { EmptyPanel, Pill } from "@/components/kdp/kdp-ui";
import { ApiError } from "@/lib/api";
import {
  exportFileUrl,
  formatDateTime,
  formatWords,
  kdpPath,
  kdpSend,
} from "@/lib/kdp";

import { formatMegabytes, StatusLine, useAction } from "./shared";

const fileLabels: Record<ExportFile["kind"], string> = {
  zip: "Complete publisher kit (ZIP)",
  epub: "EPUB for the KDP upload",
  docx: "Word manuscript (DOCX)",
  "cover-jpeg": "eBook cover (JPEG)",
  "metadata-html": "Listing sheet",
  "metadata-json": "Listing data (JSON)",
  "disclosure-report": "AI disclosure report",
  "editorial-report": "Editorial report",
  "cover-prompts": "Cover prompts",
  markdown: "Manuscript (Markdown)",
  text: "Manuscript (plain text)",
  "project-backup": "Project backup (JSON)",
};

const fileOrder = Object.keys(fileLabels) as Array<ExportFile["kind"]>;

export function sortedFiles(files: ExportFile[]): ExportFile[] {
  return [...files].sort(
    (a, b) => fileOrder.indexOf(a.kind) - fileOrder.indexOf(b.kind),
  );
}

function ExportCard({ bookId, item }: { bookId: string; item: BookExport }) {
  const validation = item.validation;
  return (
    <article className={`kdp-pub-export ${item.status}`}>
      <header>
        <strong>Export of {formatDateTime(item.createdAt)}</strong>
        <Pill tone={item.status === "succeeded" ? "good" : "bad"}>
          {item.status === "succeeded" ? "Built" : "Failed"}
        </Pill>
        <span className="kdp-muted">{formatWords(item.wordCount)} words</span>
      </header>
      {item.errorMessage && <p className="notice error">{item.errorMessage}</p>}
      {item.files.length > 0 && (
        <ul className="kdp-pub-files">
          {sortedFiles(item.files).map((file) => (
            <li
              key={file.filename}
              className={file.kind === "zip" ? "primary" : ""}
            >
              <a
                href={exportFileUrl(bookId, item.id, file.filename)}
                download={file.filename}
              >
                {file.kind === "zip" ? (
                  <FileArchive size={15} />
                ) : (
                  <Download size={15} />
                )}
                <span>
                  <strong>{fileLabels[file.kind]}</strong>
                  <small>
                    {file.filename} · {formatMegabytes(file.byteSize)}
                  </small>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {validation && (
        <div className="kdp-pub-validation">
          <div>
            <h4>EPUB structure</h4>
            <Pill
              tone={
                validation.epubStructure.ok
                  ? validation.epubStructure.warnings.length
                    ? "warn"
                    : "good"
                  : "bad"
              }
            >
              {validation.epubStructure.ok
                ? validation.epubStructure.warnings.length
                  ? `${validation.epubStructure.warnings.length} warnings`
                  : "No problems"
                : `${validation.epubStructure.errors.length} errors`}
            </Pill>
            {[
              ...validation.epubStructure.errors,
              ...validation.epubStructure.warnings,
            ].length > 0 && (
              <ul>
                {validation.epubStructure.errors.map((issue, index) => (
                  <li key={`e${index}`} className="bad">
                    {issue.message}
                    {issue.path && <small> ({issue.path})</small>}
                  </li>
                ))}
                {validation.epubStructure.warnings.map((issue, index) => (
                  <li key={`w${index}`} className="warn">
                    {issue.message}
                    {issue.path && <small> ({issue.path})</small>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4>EPUBCheck</h4>
            {validation.epubcheck.available ? (
              <>
                <Pill tone={validation.epubcheck.passed ? "good" : "bad"}>
                  {validation.epubcheck.passed ? "Passed" : "Did not pass"}
                </Pill>
                <p className="kdp-muted">
                  Version {validation.epubcheck.version ?? "unknown"}:{" "}
                  {validation.epubcheck.fatal} fatal,{" "}
                  {validation.epubcheck.errors} errors,{" "}
                  {validation.epubcheck.warnings} warnings.
                </p>
                {validation.epubcheck.messages.length > 0 && (
                  <details className="kdp-details">
                    <summary>
                      Messages ({validation.epubcheck.messages.length})
                    </summary>
                    <div>
                      <ul className="kdp-pub-messages">
                        {validation.epubcheck.messages.map((message, index) => (
                          <li key={index}>
                            <code>
                              {message.severity} {message.id}
                            </code>{" "}
                            {message.message}
                            {message.location && (
                              <small> ({message.location})</small>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                )}
              </>
            ) : (
              <p className="kdp-muted">
                EPUBCheck is not installed, so only the built-in checks ran.
              </p>
            )}
          </div>
          <div>
            <h4>DOCX</h4>
            <Pill tone={validation.docx.ok ? "good" : "bad"}>
              {validation.docx.ok
                ? "No problems"
                : `${validation.docx.errors.length} errors`}
            </Pill>
            {validation.docx.errors.length > 0 && (
              <ul>
                {validation.docx.errors.map((message, index) => (
                  <li key={index} className="bad">
                    {message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export function ExportPanel({
  bookId,
  items,
  onBuilt,
}: {
  bookId: string;
  items: BookExport[] | undefined;
  onBuilt: (item: BookExport) => void;
}) {
  const { busy, status, run } = useAction();
  const sorted = [...(items ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const [latest, ...earlier] = sorted;

  const build = () =>
    void run("export", async () => {
      try {
        const result = await kdpSend<BookExport>(
          kdpPath(bookId, "/exports"),
          "POST",
        );
        onBuilt(result);
        return "Export finished. Download the files below.";
      } catch (reason) {
        if (
          reason instanceof ApiError &&
          reason.status === 422 &&
          reason.problem
        ) {
          const failed = reason.problem as unknown as BookExport;
          if (failed.id) onBuilt(failed);
          throw new Error(
            failed.errorMessage ?? "The export could not be built.",
          );
        }
        throw reason;
      }
    });

  return (
    <section
      className="kdp-card kdp-pub-exports"
      aria-labelledby="kdp-pub-exports-title"
    >
      <header>
        <div>
          <h2 id="kdp-pub-exports-title">Export and publisher kit</h2>
          <p>
            Builds the EPUB and DOCX manuscript, the cover, the listing sheet
            and reports, and checks the files.
          </p>
        </div>
        <button
          type="button"
          className="button primary"
          disabled={!!busy}
          onClick={build}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <PackageCheck size={15} />
          )}
          Build export
        </button>
      </header>
      <StatusLine status={status} />
      {!items ? (
        <p className="kdp-muted" aria-busy="true">
          Loading exports…
        </p>
      ) : !latest ? (
        <EmptyPanel icon={<PackageCheck size={22} />} title="No export yet">
          Build an export once every chapter has text.
        </EmptyPanel>
      ) : (
        <>
          <ExportCard bookId={bookId} item={latest} />
          {earlier.length > 0 && (
            <details className="kdp-details kdp-pub-earlier">
              <summary>Earlier exports ({earlier.length})</summary>
              <div>
                {earlier.map((item) => (
                  <ExportCard key={item.id} bookId={bookId} item={item} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
      <ul className="kdp-pub-notes">
        <li>
          Passing EPUBCheck means the file is valid EPUB; it is not KDP
          approval.
        </li>
        <li>
          KDP accepts EPUB and DOCX. To make a KPF file, import the DOCX into
          Kindle Create and export from there.
        </li>
      </ul>
    </section>
  );
}
