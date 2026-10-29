"use client";

import type { ChapterCard, ChapterListItem } from "@ai-film-studio/contracts";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  ListOrdered,
  Lock,
  LockOpen,
  PencilLine,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyPanel, Pill } from "@/components/kdp/kdp-ui";
import {
  errorMessage,
  formatWords,
  kdpDelete,
  kdpPath,
  kdpSend,
} from "@/lib/kdp";

const listFields: Array<[keyof ChapterCard, string]> = [
  ["newInformation", "New information"],
  ["clues", "Clues"],
  ["continuityReferences", "Continuity references"],
];

const textFields: Array<[keyof ChapterCard, string, number]> = [
  ["objective", "Chapter objective", 2],
  ["openingHook", "Opening hook", 2],
  ["conflict", "Conflict and escalation", 2],
  ["emotionalMovement", "Emotional movement", 2],
  ["endingBeat", "Ending beat or transition", 2],
];

const statusTone = {
  planned: "neutral",
  drafting: "accent",
  drafted: "warn",
  revised: "warn",
  approved: "good",
} as const;

export function blankCard(targetWords: number): ChapterCard {
  return {
    title: "New chapter",
    povCharacter: "",
    location: "",
    time: "",
    objective: "Describe what this chapter must achieve.",
    openingHook: "How the chapter opens.",
    scenes: [{ summary: "First scene", purpose: "Why it matters" }],
    conflict: "What stands in the way.",
    newInformation: [],
    clues: [],
    continuityReferences: [],
    emotionalMovement: "From … to …",
    endingBeat: "How it ends.",
    dependsOn: [],
    targetWords,
  };
}

function CardEditor({
  card,
  onSave,
  onCancel,
}: {
  card: ChapterCard;
  onSave: (card: ChapterCard) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ChapterCard>(card);
  const [error, setError] = useState<string>();
  const set = <K extends keyof ChapterCard>(key: K, value: ChapterCard[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <form
      className="kdp-card-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...draft,
          povCharacter: draft.povCharacter || "Narrator",
          location: draft.location || "—",
          time: draft.time || "—",
        }).catch((reason: unknown) => setError(errorMessage(reason)));
      }}
    >
      <div className="field-grid">
        <label className="field">
          <span>Title (optional)</span>
          <input
            value={draft.title ?? ""}
            onChange={(event) => set("title", event.target.value || null)}
          />
        </label>
        <label className="field">
          <span>Target words</span>
          <input
            type="number"
            min={100}
            max={30000}
            step={50}
            value={draft.targetWords}
            onChange={(event) => set("targetWords", Number(event.target.value))}
          />
        </label>
        <label className="field">
          <span>Viewpoint character</span>
          <input
            value={draft.povCharacter}
            onChange={(event) => set("povCharacter", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Location</span>
          <input
            value={draft.location}
            onChange={(event) => set("location", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Time</span>
          <input
            value={draft.time}
            onChange={(event) => set("time", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Depends on chapters (comma separated)</span>
          <input
            value={draft.dependsOn.join(", ")}
            onChange={(event) =>
              set(
                "dependsOn",
                event.target.value
                  .split(",")
                  .map((value) => Number(value.trim()))
                  .filter((value) => Number.isInteger(value) && value > 0),
              )
            }
          />
        </label>
      </div>
      {textFields.map(([key, label, rows]) => (
        <label className="field" key={key}>
          <span>{label}</span>
          <textarea
            rows={rows}
            value={draft[key] as string}
            onChange={(event) => set(key, event.target.value as never)}
          />
        </label>
      ))}
      <fieldset className="kdp-scenes-edit">
        <legend>Scenes</legend>
        {draft.scenes.map((scene, index) => (
          <div key={index} className="kdp-scene-row">
            <span>{index + 1}</span>
            <textarea
              rows={2}
              aria-label={`Scene ${index + 1} summary`}
              value={scene.summary}
              onChange={(event) =>
                set(
                  "scenes",
                  draft.scenes.map((item, position) =>
                    position === index
                      ? { ...item, summary: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <input
              aria-label={`Scene ${index + 1} purpose`}
              value={scene.purpose}
              onChange={(event) =>
                set(
                  "scenes",
                  draft.scenes.map((item, position) =>
                    position === index
                      ? { ...item, purpose: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove scene ${index + 1}`}
              disabled={draft.scenes.length === 1}
              onClick={() =>
                set(
                  "scenes",
                  draft.scenes.filter((_, position) => position !== index),
                )
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {draft.scenes.length < 8 && (
          <button
            type="button"
            className="button ghost small"
            onClick={() =>
              set("scenes", [
                ...draft.scenes,
                { summary: "New scene", purpose: "Purpose" },
              ])
            }
          >
            <Plus size={14} /> Add scene
          </button>
        )}
      </fieldset>
      {listFields.map(([key, label]) => (
        <label className="field" key={key}>
          <span>{label} (one per line)</span>
          <textarea
            rows={2}
            value={(draft[key] as string[]).join("\n")}
            onChange={(event) =>
              set(
                key,
                event.target.value
                  .split("\n")
                  .filter((line) => line.trim()) as never,
              )
            }
          />
        </label>
      ))}
      {error && <p className="notice error">{error}</p>}
      <div className="kdp-actions">
        <button className="button primary small">Save card</button>
        <button type="button" className="button ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function OutlinePanel({
  bookId,
  chapters,
  busy,
  canGenerate,
  onGenerate,
  onRegenerateCard,
  onChanged,
}: {
  bookId: string;
  chapters: ChapterListItem[];
  busy: boolean;
  canGenerate: boolean;
  onGenerate: (guidance: string) => void;
  onRegenerateCard: (chapterId: string) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string>();
  const [dragging, setDragging] = useState<string>();
  const [order, setOrder] = useState<string[] | null>(null);
  const [guidance, setGuidance] = useState("");
  const [error, setError] = useState<string>();
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const ordered = (order ?? chapters.map((chapter) => chapter.id)).flatMap(
    (id) => {
      const chapter = byId.get(id);
      return chapter ? [chapter] : [];
    },
  );
  const total = chapters.reduce((sum, chapter) => sum + chapter.targetWords, 0);
  const hasText = chapters.some((chapter) => chapter.wordCount > 0);

  const run = (action: Promise<unknown>) => {
    setError(undefined);
    action
      .then(onChanged)
      .catch((reason: unknown) => setError(errorMessage(reason)));
  };
  const saveOrder = (ids: string[]) => {
    setOrder(ids);
    run(
      kdpSend(kdpPath(bookId, "/chapters/order"), "PUT", {
        chapterIds: ids,
      }).finally(() => setOrder(null)),
    );
  };
  const move = (id: string, offset: number) => {
    const ids = ordered.map((chapter) => chapter.id);
    const index = ids.indexOf(id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ids.length) return;
    ids.splice(index, 1);
    ids.splice(target, 0, id);
    saveOrder(ids);
  };

  return (
    <section className="kdp-card" id="outline">
      <header>
        <div>
          <span className="eyebrow">
            <ListOrdered size={13} /> Stage D
          </span>
          <h2>Chapter outline</h2>
          <p>
            {chapters.length
              ? `${chapters.length} chapters · ${formatWords(total)} planned words. Drag to reorder; lock a card to protect it.`
              : "Detailed chapter cards with objectives, scenes, clues and word targets."}
          </p>
        </div>
      </header>
      {chapters.length === 0 ? (
        <EmptyPanel icon={<ListOrdered size={22} />} title="No outline yet">
          {canGenerate
            ? "Generate the plot architecture and chapter cards from the story bible."
            : "Build the story bible first."}
        </EmptyPanel>
      ) : (
        <ol className="kdp-outline">
          {ordered.map((chapter, index) => (
            <li
              key={chapter.id}
              className={`kdp-outline-item${dragging === chapter.id ? " dragging" : ""}`}
              draggable={editing !== chapter.id}
              onDragStart={(event) => {
                setDragging(chapter.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragging(undefined)}
              onDragOver={(event) => {
                event.preventDefault();
                if (!dragging || dragging === chapter.id) return;
                const ids = ordered
                  .map((item) => item.id)
                  .filter((id) => id !== dragging);
                ids.splice(
                  ids.indexOf(chapter.id) +
                    (index > ordered.findIndex((item) => item.id === dragging)
                      ? 1
                      : 0),
                  0,
                  dragging,
                );
                setOrder(ids);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (order) saveOrder(order);
                setDragging(undefined);
              }}
            >
              <div className="kdp-outline-row">
                <GripVertical
                  size={16}
                  className="kdp-grip"
                  aria-hidden="true"
                />
                <span className="kdp-outline-number">{index + 1}</span>
                <div className="kdp-outline-main">
                  <strong>{chapter.title ?? `Chapter ${index + 1}`}</strong>
                  <small>
                    {chapter.card.povCharacter} · {chapter.card.location} ·{" "}
                    {chapter.card.time}
                  </small>
                  <p>{chapter.card.objective}</p>
                </div>
                <div className="kdp-outline-meta">
                  <Pill tone={statusTone[chapter.status]}>
                    {chapter.status}
                  </Pill>
                  <small>
                    {chapter.wordCount
                      ? `${formatWords(chapter.wordCount)} / `
                      : ""}
                    {formatWords(chapter.targetWords)} words
                  </small>
                </div>
                <div className="kdp-outline-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move chapter ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(chapter.id, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move chapter ${index + 1} down`}
                    disabled={index === ordered.length - 1}
                    onClick={() => move(chapter.id, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={
                      chapter.locked ? "Unlock chapter" : "Lock chapter"
                    }
                    title={
                      chapter.locked ? "Locked: AI will not change it" : "Lock"
                    }
                    onClick={() =>
                      run(
                        kdpSend(
                          kdpPath(bookId, `/chapters/${chapter.id}`),
                          "PATCH",
                          { locked: !chapter.locked },
                        ),
                      )
                    }
                  >
                    {chapter.locked ? (
                      <Lock size={14} />
                    ) : (
                      <LockOpen size={14} />
                    )}
                  </button>
                </div>
              </div>
              <details
                className="kdp-outline-details"
                open={editing === chapter.id}
              >
                <summary>Card details</summary>
                {editing === chapter.id ? (
                  <CardEditor
                    card={chapter.card}
                    onCancel={() => setEditing(undefined)}
                    onSave={async (card) => {
                      await kdpSend(
                        kdpPath(bookId, `/chapters/${chapter.id}`),
                        "PATCH",
                        { card },
                      );
                      setEditing(undefined);
                      onChanged();
                    }}
                  />
                ) : (
                  <div className="kdp-card-view">
                    <p>
                      <strong>Opening hook:</strong> {chapter.card.openingHook}
                    </p>
                    <ol>
                      {chapter.card.scenes.map((scene, position) => (
                        <li key={position}>
                          {scene.summary} <em>— {scene.purpose}</em>
                        </li>
                      ))}
                    </ol>
                    <p>
                      <strong>Conflict:</strong> {chapter.card.conflict}
                    </p>
                    <p>
                      <strong>Emotional movement:</strong>{" "}
                      {chapter.card.emotionalMovement}
                    </p>
                    <p>
                      <strong>Ending beat:</strong> {chapter.card.endingBeat}
                    </p>
                    {chapter.card.clues.length > 0 && (
                      <p>
                        <strong>Clues:</strong> {chapter.card.clues.join("; ")}
                      </p>
                    )}
                    <div className="kdp-actions">
                      <button
                        type="button"
                        className="button ghost small"
                        disabled={chapter.locked}
                        onClick={() => setEditing(chapter.id)}
                      >
                        <PencilLine size={14} /> Edit card
                      </button>
                      <button
                        type="button"
                        className="button ghost small"
                        disabled={busy || chapter.locked}
                        onClick={() => onRegenerateCard(chapter.id)}
                      >
                        <RefreshCw size={14} /> Regenerate card
                      </button>
                      <button
                        type="button"
                        className="button ghost small"
                        onClick={() =>
                          run(
                            kdpSend(kdpPath(bookId, "/chapters"), "POST", {
                              afterChapterId: chapter.id,
                              card: blankCard(chapter.targetWords),
                            }),
                          )
                        }
                      >
                        <Plus size={14} /> Add chapter after
                      </button>
                      <Link
                        className="button ghost small"
                        href={`/kdp/books/${bookId}/chapters?chapter=${chapter.id}`}
                      >
                        Open in editor
                      </Link>
                      <button
                        type="button"
                        className="button danger small"
                        disabled={chapter.locked}
                        onClick={() => {
                          const warning = chapter.wordCount
                            ? `Delete chapter ${index + 1} and its ${formatWords(chapter.wordCount)} words from the book?`
                            : `Delete chapter ${index + 1}?`;
                          if (window.confirm(warning))
                            run(
                              kdpDelete(
                                kdpPath(bookId, `/chapters/${chapter.id}`),
                              ),
                            );
                        }}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </details>
            </li>
          ))}
        </ol>
      )}
      {error && <p className="notice error">{error}</p>}
      {canGenerate && (
        <div className="kdp-generate-row">
          <label className="field">
            <span>Direction for the outline (optional)</span>
            <input
              value={guidance}
              maxLength={4000}
              placeholder="e.g. a dual timeline, a midpoint betrayal"
              onChange={(event) => setGuidance(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={busy || hasText}
            title={
              hasText
                ? "Chapters already have text; regenerate single cards instead."
                : undefined
            }
            onClick={() => {
              if (
                !chapters.length ||
                window.confirm(
                  "Replace the whole outline? Cards you edited will be replaced.",
                )
              )
                onGenerate(guidance);
            }}
          >
            {chapters.length ? (
              <RefreshCw size={15} />
            ) : (
              <ListOrdered size={15} />
            )}
            {chapters.length
              ? "Regenerate outline"
              : "Generate plot and outline"}
          </button>
        </div>
      )}
    </section>
  );
}
