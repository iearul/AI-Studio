"use client";

import type { BookSummary, CoverAsset } from "@ai-film-studio/contracts";
import { LoaderCircle, Move, RotateCcw, Save, Type } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { coverUrl, uploadCover } from "@/lib/kdp";

import { provenanceLabels, StatusLine, useAction } from "./shared";

const WIDTH = 1600;
const HEIGHT = 2560;
const MARGIN = 120;

const fontOptions = [
  { id: "Georgia", stack: "Georgia, serif" },
  {
    id: "Palatino",
    stack: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
  },
  { id: "Times New Roman", stack: '"Times New Roman", Times, serif' },
  { id: "Didot", stack: 'Didot, "Bodoni 72", "Bodoni MT", serif' },
  { id: "Baskerville", stack: 'Baskerville, "Baskerville Old Face", serif' },
  {
    id: "Helvetica Neue",
    stack: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  { id: "Avenir Next", stack: '"Avenir Next", Avenir, "Segoe UI", sans-serif' },
  { id: "Futura", stack: 'Futura, "Century Gothic", sans-serif' },
  {
    id: "Gill Sans",
    stack: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif',
  },
] as const;

type FontId = (typeof fontOptions)[number]["id"];
type LayerKey = "series" | "title" | "subtitle" | "author";

type TextLayer = {
  text: string;
  font: FontId;
  size: number;
  color: string;
  /** Centre of the text block, in percent of the cover height. */
  y: number;
  /** Extra space between letters, in cover pixels. */
  spacing: number;
  uppercase: boolean;
  bold: boolean;
};

type Look = {
  scrim: "none" | "dark" | "light";
  area: "top" | "bottom" | "both";
  strength: number;
  shadow: boolean;
};

type Placement = { zoom: number; x: number; y: number };

const layerOrder: Array<{ key: LayerKey; label: string; optional: boolean }> = [
  { key: "title", label: "Title", optional: false },
  { key: "subtitle", label: "Subtitle", optional: true },
  { key: "author", label: "Author", optional: false },
  { key: "series", label: "Series line", optional: true },
];

function seriesLine(book: BookSummary): string {
  if (!book.seriesName) return "";
  return book.seriesNumber
    ? `${book.seriesName} · Book ${book.seriesNumber}`
    : book.seriesName;
}

function initialLayers(book: BookSummary): Record<LayerKey, TextLayer> {
  return {
    series: {
      text: seriesLine(book),
      font: "Gill Sans",
      size: 54,
      color: "#f4efe6",
      y: 6,
      spacing: 10,
      uppercase: true,
      bold: false,
    },
    title: {
      text: book.title,
      font: "Georgia",
      size: 180,
      color: "#ffffff",
      y: 18,
      spacing: 4,
      uppercase: true,
      bold: true,
    },
    subtitle: {
      text: book.subtitle ?? "",
      font: "Georgia",
      size: 68,
      color: "#f4efe6",
      y: 31,
      spacing: 0,
      uppercase: false,
      bold: false,
    },
    author: {
      text: book.penName ?? "",
      font: "Helvetica Neue",
      size: 92,
      color: "#ffffff",
      y: 91,
      spacing: 12,
      uppercase: true,
      bold: false,
    },
  };
}

const defaultLook: Look = {
  scrim: "dark",
  area: "both",
  strength: 0.55,
  shadow: true,
};
const defaultPlacement: Placement = { zoom: 1, x: 0, y: 0 };

// --- Drawing ---------------------------------------------------------------------

function geometry(
  imageWidth: number,
  imageHeight: number,
  placement: Placement,
) {
  const scale =
    Math.max(WIDTH / imageWidth, HEIGHT / imageHeight) * placement.zoom;
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const maxX = (width - WIDTH) / 2;
  const maxY = (height - HEIGHT) / 2;
  const x = Math.min(maxX, Math.max(-maxX, placement.x));
  const y = Math.min(maxY, Math.max(-maxY, placement.y));
  return {
    left: (WIDTH - width) / 2 + x,
    top: (HEIGHT - height) / 2 + y,
    width,
    height,
    x,
    y,
  };
}

function fontStack(id: FontId): string {
  return fontOptions.find((option) => option.id === id)?.stack ?? "serif";
}

function measure(ctx: CanvasRenderingContext2D, text: string, spacing: number) {
  return (
    ctx.measureText(text).width + spacing * Math.max(0, [...text].length - 1)
  );
}

function wrap(ctx: CanvasRenderingContext2D, text: string, spacing: number) {
  const maxWidth = WIDTH - MARGIN * 2;
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measure(ctx, candidate, spacing) <= maxWidth)
      current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  spacing: number,
) {
  let x = (WIDTH - measure(ctx, text, spacing)) / 2;
  if (spacing === 0) {
    ctx.fillText(text, x, y);
    return;
  }
  for (const char of text) {
    ctx.fillText(char, x, y);
    x += ctx.measureText(char).width + spacing;
  }
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  shadow: boolean,
) {
  const raw = layer.text.trim();
  if (!raw) return;
  const text = layer.uppercase ? raw.toLocaleUpperCase() : raw;
  ctx.save();
  ctx.font = `${layer.bold ? 700 : 400} ${layer.size}px ${fontStack(layer.font)}`;
  ctx.fillStyle = layer.color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if (shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = Math.max(6, layer.size * 0.1);
    ctx.shadowOffsetY = Math.max(2, layer.size * 0.02);
  }
  const lines = wrap(ctx, text, layer.spacing);
  const lineHeight = layer.size * 1.12;
  const first =
    (layer.y / 100) * HEIGHT - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) =>
    drawLine(ctx, line, first + index * lineHeight, layer.spacing),
  );
  ctx.restore();
}

function drawScrim(ctx: CanvasRenderingContext2D, look: Look) {
  if (look.scrim === "none" || look.strength <= 0) return;
  const rgb = look.scrim === "dark" ? "0, 0, 0" : "255, 255, 255";
  const band = HEIGHT * 0.42;
  const paint = (from: number, to: number) => {
    const gradient = ctx.createLinearGradient(0, from, 0, to);
    gradient.addColorStop(0, `rgba(${rgb}, ${look.strength})`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, Math.min(from, to), WIDTH, band);
  };
  if (look.area !== "bottom") paint(0, band);
  if (look.area !== "top") paint(HEIGHT, HEIGHT - band);
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap | null,
  placement: Placement,
  layers: Record<LayerKey, TextLayer>,
  look: Look,
) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#2b2a25";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (image) {
    const box = geometry(image.width, image.height, placement);
    ctx.drawImage(image, box.left, box.top, box.width, box.height);
  }
  drawScrim(ctx, look);
  for (const { key } of layerOrder) drawLayer(ctx, layers[key], look.shadow);
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "cover"
  );
}

// --- Component -------------------------------------------------------------------

/**
 * Sets the title, subtitle, author and series on a chosen artwork and saves a
 * 1600 × 2560 JPEG as a final cover version.
 */
export function CoverComposer({
  bookId,
  book,
  artworks,
  artworkId,
  onArtworkChange,
  onSaved,
}: {
  bookId: string;
  book: BookSummary;
  artworks: CoverAsset[];
  artworkId: string | undefined;
  onArtworkChange: (id: string) => void;
  onSaved: (cover: CoverAsset) => void;
}) {
  const artwork = artworks.find((item) => item.id === artworkId) ?? artworks[0];
  const artworkKey = artwork?.id;
  const [images, setImages] = useState<Record<string, ImageBitmap>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [placement, setPlacement] = useState<Placement>(defaultPlacement);
  const [layers, setLayers] = useState(() => initialLayers(book));
  const [look, setLook] = useState<Look>(defaultLook);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const { busy, status, run } = useAction();
  const image = artworkKey ? (images[artworkKey] ?? null) : null;
  const error =
    artworkKey && failed[artworkKey]
      ? "This artwork could not be opened in the browser. Add a JPEG, PNG or WebP version."
      : undefined;
  const hasImage = image !== null;

  // Fetching the file as a blob keeps the canvas untainted, so it can be exported.
  useEffect(() => {
    if (!artworkKey || hasImage) return;
    let cancelled = false;
    fetch(coverUrl(bookId, artworkKey))
      .then((response) => {
        if (!response.ok) throw new Error(`Status ${response.status}`);
        return response.blob();
      })
      .then((blob) => createImageBitmap(blob))
      .then((result) => {
        if (cancelled) {
          result.close();
          return;
        }
        setImages((current) => ({ ...current, [artworkKey]: result }));
      })
      .catch(() => {
        if (!cancelled)
          setFailed((current) => ({ ...current, [artworkKey]: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, artworkKey, hasImage]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawCover(ctx, image, placement, layers, look);
  }, [image, placement, layers, look]);

  const move = (dx: number, dy: number) => {
    if (!image) return;
    setPlacement((current) => {
      const box = geometry(image.width, image.height, {
        ...current,
        x: current.x + dx,
        y: current.y + dy,
      });
      return { ...current, x: box.x, y: box.y };
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const start = drag.current;
    if (!start) return;
    const ratio = WIDTH / Math.max(1, event.currentTarget.clientWidth);
    drag.current = { x: event.clientX, y: event.clientY };
    move((event.clientX - start.x) * ratio, (event.clientY - start.y) * ratio);
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const step = event.shiftKey ? 160 : 40;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[event.key];
    if (delta) {
      event.preventDefault();
      move(delta[0], delta[1]);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setPlacement((current) => ({
        ...current,
        zoom: Math.min(3, current.zoom + 0.1),
      }));
    } else if (event.key === "-") {
      event.preventDefault();
      setPlacement((current) => ({
        ...current,
        zoom: Math.max(1, current.zoom - 0.1),
      }));
    }
  };

  const updateLayer = (key: LayerKey, patch: Partial<TextLayer>) =>
    setLayers((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));

  const resetText = () =>
    setLayers((current) => ({
      series: { ...current.series, text: seriesLine(book) },
      title: { ...current.title, text: book.title },
      subtitle: { ...current.subtitle, text: book.subtitle ?? "" },
      author: { ...current.author, text: book.penName ?? "" },
    }));

  const save = () =>
    run("save", async () => {
      const canvas = canvasRef.current;
      if (!canvas || !artwork || !image)
        throw new Error("Choose artwork that has loaded first.");
      if (!layers.title.text.trim() || !layers.author.text.trim()) {
        throw new Error("The cover needs a title and an author name.");
      }
      const box = geometry(image.width, image.height, placement);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(new Error("The cover could not be exported.")),
          "image/jpeg",
          0.92,
        ),
      );
      const cover = await uploadCover(
        bookId,
        blob,
        `${slug(layers.title.text)}-cover.jpg`,
        {
          kind: "final",
          source: "composite",
          parentId: artwork.id,
          provenance: artwork.provenance,
          settings: {
            title: layers.title.text.trim(),
            subtitle: layers.subtitle.text.trim() || null,
            author: layers.author.text.trim(),
            series: layers.series.text.trim() || null,
            canvas: { width: WIDTH, height: HEIGHT },
            artwork: {
              zoom: Math.round(placement.zoom * 100) / 100,
              x: Math.round(box.x),
              y: Math.round(box.y),
            },
            layers: Object.fromEntries(
              layerOrder.map(({ key }) => {
                const layer = layers[key];
                return [
                  key,
                  {
                    font: layer.font,
                    size: layer.size,
                    color: layer.color,
                    y: layer.y,
                    spacing: layer.spacing,
                    uppercase: layer.uppercase,
                    bold: layer.bold,
                  },
                ];
              }),
            ),
            look,
          },
        },
      );
      onSaved(cover);
      return cover.validation.ok
        ? `Saved as version ${cover.version}. It is now the book cover.`
        : `Saved as version ${cover.version}, but it does not pass the KDP checks yet.`;
    });

  if (artworks.length === 0) {
    return (
      <section className="kdp-card">
        <header>
          <div>
            <h2>Cover composer</h2>
            <p>
              Add artwork first. The composer then sets your title and author on
              it.
            </p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section
      className="kdp-card kdp-cover-composer"
      aria-labelledby="kdp-cover-composer-title"
    >
      <header>
        <div>
          <h2 id="kdp-cover-composer-title">Cover composer</h2>
          <p>
            Set the title and author on your artwork and save a 1600 × 2560 px
            JPEG. Fonts are the ones installed on this computer.
          </p>
        </div>
      </header>
      <div className="kdp-cover-composer-grid">
        <div className="kdp-cover-stage">
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            tabIndex={0}
            role="img"
            aria-label={`Cover preview: ${layers.title.text} by ${layers.author.text}. Drag or use the arrow keys to move the artwork, plus and minus to zoom.`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
          />
          {!image && !error && (
            <div className="kdp-cover-stage-note" aria-live="polite">
              <LoaderCircle size={18} className="spin" /> Loading artwork…
            </div>
          )}
          {error && <p className="notice error">{error}</p>}
          <p className="kdp-muted">
            <Move size={12} aria-hidden="true" /> Drag the preview to move the
            artwork. A thumbnail on Amazon is about 1/10 of this size; check the
            title is still readable.
          </p>
        </div>

        <div className="kdp-cover-controls">
          <fieldset className="kdp-cover-group">
            <legend>Artwork</legend>
            <label className="field">
              <span>Artwork version</span>
              <select
                value={artwork?.id ?? ""}
                onChange={(event) => {
                  onArtworkChange(event.target.value);
                  setPlacement(defaultPlacement);
                }}
              >
                {artworks.map((item) => (
                  <option key={item.id} value={item.id}>
                    Version {item.version} · {item.width ?? "?"} ×{" "}
                    {item.height ?? "?"} px ·{" "}
                    {provenanceLabels[item.provenance]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Zoom ({Math.round(placement.zoom * 100)}%)</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={placement.zoom}
                onChange={(event) =>
                  setPlacement((current) => ({
                    ...current,
                    zoom: Number(event.target.value),
                  }))
                }
              />
            </label>
            <button
              type="button"
              className="button ghost small"
              onClick={() => setPlacement(defaultPlacement)}
            >
              <RotateCcw size={13} /> Fill the cover again
            </button>
          </fieldset>

          {layerOrder.map(({ key, label, optional }) => {
            const layer = layers[key];
            const id = `kdp-cover-${key}`;
            return (
              <details
                key={key}
                className="kdp-details kdp-cover-layer"
                open={key === "title"}
              >
                <summary>
                  <Type size={13} aria-hidden="true" /> {label}
                  {optional ? (
                    <span className="kdp-muted"> (optional)</span>
                  ) : null}
                  {layer.text.trim() ? (
                    <span className="kdp-cover-layer-preview">
                      {layer.text}
                    </span>
                  ) : null}
                </summary>
                <div className="kdp-cover-layer-fields">
                  <label className="field full">
                    <span>Text</span>
                    <input
                      id={`${id}-text`}
                      value={layer.text}
                      maxLength={200}
                      onChange={(event) =>
                        updateLayer(key, { text: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Font</span>
                    <select
                      value={layer.font}
                      onChange={(event) =>
                        updateLayer(key, { font: event.target.value as FontId })
                      }
                    >
                      {fontOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Colour</span>
                    <input
                      type="color"
                      value={layer.color}
                      onChange={(event) =>
                        updateLayer(key, { color: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Size ({layer.size} px)</span>
                    <input
                      type="range"
                      min={24}
                      max={400}
                      step={2}
                      value={layer.size}
                      onChange={(event) =>
                        updateLayer(key, { size: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Vertical position ({layer.y}%)</span>
                    <input
                      type="range"
                      min={2}
                      max={98}
                      step={0.5}
                      value={layer.y}
                      onChange={(event) =>
                        updateLayer(key, { y: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Letter spacing ({layer.spacing} px)</span>
                    <input
                      type="range"
                      min={0}
                      max={60}
                      step={1}
                      value={layer.spacing}
                      onChange={(event) =>
                        updateLayer(key, {
                          spacing: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <div className="kdp-cover-checks">
                    <label>
                      <input
                        type="checkbox"
                        checked={layer.uppercase}
                        onChange={(event) =>
                          updateLayer(key, { uppercase: event.target.checked })
                        }
                      />
                      Uppercase
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={layer.bold}
                        onChange={(event) =>
                          updateLayer(key, { bold: event.target.checked })
                        }
                      />
                      Bold
                    </label>
                  </div>
                </div>
              </details>
            );
          })}

          <fieldset className="kdp-cover-group">
            <legend>Legibility</legend>
            <div
              className="segmented kdp-cover-segmented"
              role="radiogroup"
              aria-label="Scrim"
            >
              {(["none", "dark", "light"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={look.scrim === value}
                  className={look.scrim === value ? "selected" : ""}
                  onClick={() =>
                    setLook((current) => ({ ...current, scrim: value }))
                  }
                >
                  {value === "none"
                    ? "No scrim"
                    : value === "dark"
                      ? "Dark scrim"
                      : "Light scrim"}
                </button>
              ))}
            </div>
            {look.scrim !== "none" && (
              <div className="kdp-cover-row">
                <label className="field">
                  <span>Where</span>
                  <select
                    value={look.area}
                    onChange={(event) =>
                      setLook((current) => ({
                        ...current,
                        area: event.target.value as Look["area"],
                      }))
                    }
                  >
                    <option value="both">Top and bottom</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </label>
                <label className="field">
                  <span>Strength ({Math.round(look.strength * 100)}%)</span>
                  <input
                    type="range"
                    min={0.1}
                    max={0.9}
                    step={0.05}
                    value={look.strength}
                    onChange={(event) =>
                      setLook((current) => ({
                        ...current,
                        strength: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
            )}
            <label className="kdp-cover-checks">
              <input
                type="checkbox"
                checked={look.shadow}
                onChange={(event) =>
                  setLook((current) => ({
                    ...current,
                    shadow: event.target.checked,
                  }))
                }
              />
              Soft shadow behind the text
            </label>
          </fieldset>

          <div className="kdp-actions">
            <button
              type="button"
              className="button primary"
              disabled={!image || !!busy}
              onClick={() => void save()}
            >
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Save size={15} />
              )}
              Save as final cover
            </button>
            <button
              type="button"
              className="button ghost small"
              onClick={resetText}
            >
              <RotateCcw size={13} /> Text from book
            </button>
          </div>
          {artwork && (
            <p className="kdp-muted">
              The saved cover keeps the artwork’s classification:{" "}
              {provenanceLabels[artwork.provenance]}.
            </p>
          )}
          <StatusLine status={status} />
        </div>
      </div>
    </section>
  );
}
