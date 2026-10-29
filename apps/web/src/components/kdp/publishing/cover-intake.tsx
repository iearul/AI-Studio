"use client";

import type { CoverAsset, ProvenanceClass } from "@ai-film-studio/contracts";
import { ImagePlus, LoaderCircle, Upload } from "lucide-react";
import { useCallback, useEffect, useState, type DragEvent } from "react";

import { uploadCover } from "@/lib/kdp";

import {
  imageProvenanceOptions,
  provenanceHints,
  provenanceLabels,
  StatusLine,
  useAction,
} from "./shared";

const acceptedTypes = ["image/jpeg", "image/png", "image/webp", "image/tiff"];
const accept = acceptedTypes.join(",");
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/tiff": "tif",
};

function ProvenanceRadios({
  name,
  value,
  onChange,
  legend,
}: {
  name: string;
  value: ProvenanceClass | "";
  onChange: (value: ProvenanceClass) => void;
  legend: string;
}) {
  return (
    <fieldset className="kdp-cover-provenance">
      <legend>{legend}</legend>
      {imageProvenanceOptions.map((option) => (
        <label key={option} className={value === option ? "selected" : ""}>
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          <span>
            <strong>{provenanceLabels[option]}</strong>
            <small>{provenanceHints[option]}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Artwork without lettering, from a file, drag and drop or the clipboard.
 * Paste works anywhere on the page while it is open.
 */
export function ArtworkIntake({
  bookId,
  onUploaded,
}: {
  bookId: string;
  onUploaded: (cover: CoverAsset) => void;
}) {
  const [provenance, setProvenance] = useState<ProvenanceClass>("ai-generated");
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const { busy, status, setStatus, run } = useAction();

  const upload = useCallback(
    (file: Blob, filename: string, source: "upload" | "drop" | "paste") =>
      run("artwork", async () => {
        if (!acceptedTypes.includes(file.type)) {
          throw new Error("Use a JPEG, PNG, WebP or TIFF image.");
        }
        const cover = await uploadCover(bookId, file, filename, {
          kind: "artwork",
          source,
          provenance,
          provenanceNote: note.trim() || null,
        });
        onUploaded(cover);
        return `Artwork added as version ${cover.version}. It is selected in the composer below.`;
      }),
    [bookId, note, onUploaded, provenance, run],
  );

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      // Text copied from a word processor can carry an image of itself; keep
      // text pastes into form fields as text.
      const target = event.target;
      const editable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (editable && event.clipboardData?.types.includes("text/plain")) return;
      const items = event.clipboardData ? [...event.clipboardData.items] : [];
      const file = items
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();
      if (!file) return;
      event.preventDefault();
      if (busy) return;
      const extension = extensions[file.type] ?? "png";
      void upload(file, `pasted-artwork-${Date.now()}.${extension}`, "paste");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [busy, upload]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = [...event.dataTransfer.files].find((item) =>
      item.type.startsWith("image/"),
    );
    if (!file) {
      setStatus({ tone: "error", text: "Drop an image file." });
      return;
    }
    if (!busy) void upload(file, file.name, "drop");
  };

  return (
    <section className="kdp-card">
      <header>
        <div>
          <h2>Add artwork</h2>
          <p>
            Background art without title or author text. You add the lettering
            in the composer.
          </p>
        </div>
      </header>
      <ProvenanceRadios
        name="artwork-provenance"
        legend="1. Who made this artwork?"
        value={provenance}
        onChange={setProvenance}
      />
      <label className="field kdp-cover-note">
        <span>Note (optional, for example the tool you used)</span>
        <input
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <p className="kdp-cover-step">2. Add the image</p>
      <div
        className={`kdp-cover-drop ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {busy ? (
          <LoaderCircle size={22} className="spin" />
        ) : (
          <ImagePlus size={22} />
        )}
        <p>
          Drop an image here, paste it with ⌘V / Ctrl+V anywhere on this page,
          or
        </p>
        <label className="button secondary small kdp-pub-file">
          <Upload size={14} /> Choose a file
          <input
            type="file"
            accept={accept}
            disabled={!!busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file, file.name, "upload");
            }}
          />
        </label>
        <small>JPEG, PNG, WebP or TIFF.</small>
      </div>
      <StatusLine status={status} />
    </section>
  );
}

/** A complete cover made elsewhere, already lettered. */
export function FinishedCoverUpload({
  bookId,
  title,
  author,
  onUploaded,
}: {
  bookId: string;
  title: string;
  author: string;
  onUploaded: (cover: CoverAsset) => void;
}) {
  const [provenance, setProvenance] = useState<ProvenanceClass | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const [file, setFile] = useState<File>();
  const { busy, status, run } = useAction();
  const ready = !!file && provenance !== "" && confirmed && !busy;

  const submit = () =>
    run("final", async () => {
      if (!file || provenance === "") return;
      const cover = await uploadCover(bookId, file, file.name, {
        kind: "final",
        source: "upload",
        provenance,
        settings: { textConfirmedByAuthor: true },
      });
      onUploaded(cover);
      setFile(undefined);
      setConfirmed(false);
      return cover.validation.ok
        ? `Saved as version ${cover.version}. It is now the book cover.`
        : `Saved as version ${cover.version}, but it does not meet the KDP cover rules. See the version list.`;
    });

  return (
    <section className="kdp-card">
      <header>
        <div>
          <h2>Upload a finished cover</h2>
          <p>
            A complete eBook cover with title and author already on it, made by
            you or a designer.
          </p>
        </div>
      </header>
      <ProvenanceRadios
        name="final-provenance"
        legend="Who made this cover?"
        value={provenance}
        onChange={setProvenance}
      />
      <label className="button secondary small kdp-pub-file kdp-cover-final-file">
        <Upload size={14} /> {file ? file.name : "Choose a JPEG or TIFF"}
        <input
          type="file"
          accept="image/jpeg,image/tiff"
          disabled={!!busy}
          onChange={(event) => setFile(event.target.files?.[0])}
        />
      </label>
      <label className="toggle-row kdp-cover-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          <strong>
            The cover shows the same title and author name as the listing.
          </strong>
          <small>
            Title “{title || "—"}”, author “{author || "—"}”. KDP requires them
            to match.
          </small>
        </span>
      </label>
      <div className="kdp-actions">
        <button
          type="button"
          className="button primary"
          disabled={!ready}
          onClick={() => void submit()}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Upload size={15} />
          )}
          Upload finished cover
        </button>
        {!ready && !busy && (
          <span className="kdp-muted">
            {provenance === ""
              ? "Choose who made it first."
              : !file
                ? "Choose a file."
                : !confirmed
                  ? "Confirm the cover text."
                  : ""}
          </span>
        )}
      </div>
      <StatusLine status={status} />
    </section>
  );
}
