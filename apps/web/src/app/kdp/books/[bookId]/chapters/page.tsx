"use client";

import type {
  Chapter,
  ChapterListItem,
  ChapterRevision,
  EditorialIssue,
  PassageOperation,
  PassageResult,
  StoryBibleRecord,
} from "@ai-studio/contracts";
import { countManuscriptWords } from "@ai-studio/book-engine";
import type { Editor } from "@tiptap/react";
import {
  AlertTriangle,
  BadgeCheck,
  BookOpenText,
  Download,
  History,
  Lock,
  LockOpen,
  NotebookPen,
  RefreshCw,
  Save,
  ScanSearch,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { useBook } from "@/components/kdp/book-context";
import { EmptyPanel, Pill, ProgressBar } from "@/components/kdp/kdp-ui";
import {
  changeSummary,
  diffText,
  type DiffPart,
} from "@/components/kdp/writing/diff";
import {
  ManuscriptEditor,
  replaceRange,
  type SelectionInfo,
} from "@/components/kdp/writing/manuscript-editor";
import {
  chapterExportUrl,
  errorMessage,
  formatDateTime,
  formatUsd,
  formatWords,
  kdpPath,
  kdpSend,
  startJob,
  useResource,
} from "@/lib/kdp";

type SaveState = {
  kind: "idle" | "saving" | "saved" | "error" | "conflict";
  message?: string;
};
type PanelTab = "card" | "bible" | "warnings" | "notes" | "history";

const operations: Array<{ id: PassageOperation; label: string }> = [
  { id: "rewrite", label: "Rewrite" },
  { id: "expand", label: "Expand scene" },
  { id: "improve-dialogue", label: "Improve dialogue" },
  { id: "adjust-pacing", label: "Adjust pacing" },
  { id: "fix-grammar", label: "Fix grammar" },
];

const revisionLabels: Record<ChapterRevision["source"], string> = {
  "ai-draft": "AI draft",
  "ai-expansion": "AI expansion",
  "ai-rewrite": "AI rewrite accepted",
  "ai-edit": "AI correction accepted",
  "user-edit": "Your edit",
  "editorial-accept": "Editorial fix accepted",
  restore: "Restored",
  import: "Imported",
};

function DiffView({ parts }: { parts: DiffPart[] }) {
  return (
    <div className="kdp-diff">
      {parts.map((part, index) =>
        part.type === "same" ? (
          <span key={index}>{part.text}</span>
        ) : part.type === "added" ? (
          <ins key={index}>{part.text}</ins>
        ) : (
          <del key={index}>{part.text}</del>
        ),
      )}
    </div>
  );
}

function ChapterWorkspace() {
  const { bookId, activeJobs, refreshJobs, settledVersion } = useBook();
  const router = useRouter();
  const search = useSearchParams();
  const list = useResource<{ items: ChapterListItem[] }>(
    kdpPath(bookId, "/chapters"),
  );
  const items = list.data?.items ?? [];
  const chapterId = search.get("chapter") ?? items[0]?.id ?? null;
  const chapterResource = useResource<Chapter>(
    chapterId ? kdpPath(bookId, `/chapters/${chapterId}`) : null,
  );
  const chapter = chapterResource.data;
  const bible = useResource<{ record: StoryBibleRecord | null }>(
    kdpPath(bookId, "/bible"),
  );
  const editorial = useResource<{ issues: EditorialIssue[] }>(
    kdpPath(bookId, "/editorial"),
  );
  const revisions = useResource<{ items: ChapterRevision[] }>(
    chapterId ? kdpPath(bookId, `/chapters/${chapterId}/revisions`) : null,
  );

  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [base, setBase] = useState(0);
  const [adopted, setAdopted] = useState<string>();
  const [editorVersion, setEditorVersion] = useState(0);
  const [editor, setEditor] = useState<Editor>();
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [instruction, setInstruction] = useState("");
  const [aiBusy, setAiBusy] = useState<PassageOperation>();
  const [suggestion, setSuggestion] = useState<
    (PassageResult & { from: number; to: number }) | null
  >(null);
  const [panel, setPanel] = useState<PanelTab>("card");
  const [compare, setCompare] = useState<ChapterRevision>();
  const [notes, setNotes] = useState<string>();
  const [error, setError] = useState<string>();

  const contentRef = useRef("");
  const baseRef = useRef(0);
  const chapterRef = useRef<string | null>(null);
  useEffect(() => {
    baseRef.current = base;
  }, [base]);

  const dirty = content !== saved;
  // Load server text into the editor when the chapter or its revision changes,
  // but never over unsaved local edits.
  if (chapter && chapter.id === chapterId) {
    const key = `${chapter.id}:${chapter.revisionCount}`;
    const switched = !adopted?.startsWith(`${chapter.id}:`);
    if (key !== adopted && (switched || !dirty)) {
      setAdopted(key);
      setContent(chapter.content);
      setSaved(chapter.content);
      setBase(chapter.revisionCount);
      setEditorVersion((value) => value + 1);
      setNotes(chapter.authorNotes ?? "");
      setSelection(null);
      setSuggestion(null);
      setCompare(undefined);
      setSaveState({ kind: "idle" });
    }
  }
  const externalChange =
    chapter !== undefined &&
    adopted !== undefined &&
    adopted !== `${chapter.id}:${chapter.revisionCount}` &&
    dirty;

  const editable =
    chapter !== undefined && !chapter.locked && chapter.status !== "approved";
  const words = countManuscriptWords(content);

  const save = useCallback(
    async (mode: "autosave" | "manual", aiOperation?: PassageOperation) => {
      const id = chapterRef.current;
      if (!id) return;
      const markup = contentRef.current;
      setSaveState({ kind: "saving" });
      try {
        const result = await kdpSend<Chapter>(
          kdpPath(bookId, `/chapters/${id}/content`),
          "PUT",
          {
            content: markup,
            mode,
            baseRevisionCount: baseRef.current,
            ...(aiOperation ? { aiOperation } : {}),
          },
        );
        if (chapterRef.current !== id) return;
        baseRef.current = result.revisionCount;
        setBase(result.revisionCount);
        setAdopted(`${result.id}:${result.revisionCount}`);
        setSaved(markup);
        chapterResource.setData(result);
        setSaveState({
          kind: "saved",
          message:
            mode === "manual" || aiOperation
              ? `Saved revision ${result.revisionCount}`
              : "Saved",
        });
        if (mode === "manual" || aiOperation) {
          void revisions.reload();
          void list.reload();
          void editorial.reload();
        }
      } catch (reason) {
        const message = errorMessage(reason);
        setSaveState({
          kind: /changed|reload/i.test(message) ? "conflict" : "error",
          message,
        });
      }
    },
    [bookId, chapterResource, revisions, list, editorial],
  );

  useEffect(() => {
    chapterRef.current = chapter?.id ?? null;
  }, [chapter?.id]);

  // Autosave after a short pause in typing.
  useEffect(() => {
    if (!dirty || !editable || saveState.kind === "conflict") return;
    const timer = setTimeout(() => void save("autosave"), 2_500);
    return () => clearTimeout(timer);
  }, [content, dirty, editable, save, saveState.kind]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const reloadChapter = chapterResource.reload;
  const reloadList = list.reload;
  const reloadRevisions = revisions.reload;
  const reloadEditorial = editorial.reload;
  const reloadBible = bible.reload;
  useEffect(() => {
    if (settledVersion === 0) return;
    const timer = setTimeout(() => {
      void reloadChapter();
      void reloadList();
      void reloadRevisions();
      void reloadEditorial();
      void reloadBible();
    }, 0);
    return () => clearTimeout(timer);
  }, [
    settledVersion,
    reloadChapter,
    reloadList,
    reloadRevisions,
    reloadEditorial,
    reloadBible,
  ]);

  const onChange = useCallback((markup: string) => {
    contentRef.current = markup;
    setContent(markup);
  }, []);
  const onReady = useCallback((instance: Editor) => setEditor(instance), []);
  const onSave = useCallback(() => void save("manual"), [save]);

  const open = async (id: string) => {
    if (dirty && editable) await save("autosave");
    router.replace(`/kdp/books/${bookId}/chapters?chapter=${id}`, {
      scroll: false,
    });
  };

  const patch = (body: Record<string, unknown>) => {
    if (!chapter) return;
    setError(undefined);
    kdpSend<Chapter>(kdpPath(bookId, `/chapters/${chapter.id}`), "PATCH", body)
      .then((result) => {
        chapterResource.setData((current) => ({
          ...result,
          content: current?.content ?? result.content,
        }));
        void list.reload();
      })
      .catch((reason: unknown) => setError(errorMessage(reason)));
  };

  const job = (input: Parameters<typeof startJob>[1]) => {
    setError(undefined);
    startJob(bookId, input)
      .then(() => refreshJobs())
      .catch((reason: unknown) => setError(errorMessage(reason)));
  };

  const runPassage = (operation: PassageOperation) => {
    if (!chapter || !selection) return;
    setAiBusy(operation);
    setError(undefined);
    const range = { from: selection.from, to: selection.to };
    kdpSend<PassageResult>(
      kdpPath(bookId, `/chapters/${chapter.id}/passage`),
      "POST",
      {
        operation,
        passage: selection.markup,
        instruction: instruction.trim() || null,
      },
    )
      .then((result) => setSuggestion({ ...result, ...range }))
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setAiBusy(undefined));
  };

  const acceptSuggestion = () => {
    if (!editor || !suggestion) return;
    replaceRange(
      editor,
      suggestion.from,
      suggestion.to,
      suggestion.replacement,
    );
    const operation = suggestion.operation;
    setSuggestion(null);
    setSelection(null);
    void save("manual", operation);
  };

  if (list.loading) return <div className="kdp-card" aria-busy="true" />;
  if (items.length === 0) {
    return (
      <EmptyPanel
        icon={<BookOpenText size={22} />}
        title="No chapters yet"
        action={
          <Link
            className="button primary"
            href={`/kdp/books/${bookId}#outline`}
          >
            Create the outline
          </Link>
        }
      >
        Chapters appear here once the outline exists.
      </EmptyPanel>
    );
  }

  const chapterIssues = (editorial.data?.issues ?? []).filter(
    (issue) => issue.chapterId === chapterId && issue.status === "open",
  );
  const draftRunning = activeJobs.some((item) => item.kind === "draft");
  const characters = bible.data?.record?.bible.characters ?? [];
  const facts = bible.data?.record?.bible.canonFacts ?? [];

  return (
    <div className="kdp-workspace">
      <aside className="kdp-chapter-nav" aria-label="Chapters">
        <label className="kdp-chapter-select">
          <span className="kdp-visually-hidden">Chapter</span>
          <select
            value={chapterId ?? ""}
            onChange={(event) => void open(event.target.value)}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.number}. {item.title ?? `Chapter ${item.number}`}
              </option>
            ))}
          </select>
        </label>
        <ol>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === chapterId ? "active" : ""}
                onClick={() => void open(item.id)}
                aria-current={item.id === chapterId}
              >
                <span className="kdp-nav-number">{item.number}</span>
                <span className="kdp-nav-text">
                  <strong>{item.title ?? `Chapter ${item.number}`}</strong>
                  <small>
                    {formatWords(item.wordCount)} /{" "}
                    {formatWords(item.targetWords)}
                  </small>
                  <ProgressBar
                    value={item.wordCount / Math.max(1, item.targetWords)}
                  />
                </span>
                {item.status === "approved" ? (
                  <BadgeCheck size={15} aria-label="Approved" />
                ) : item.locked ? (
                  <Lock size={14} aria-label="Locked" />
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <section className="kdp-editor-column">
        {chapter && chapter.id === chapterId ? (
          <>
            <div className="kdp-editor-head">
              <input
                className="kdp-chapter-title"
                aria-label="Chapter title"
                defaultValue={chapter.title ?? ""}
                key={`${chapter.id}-title`}
                placeholder={`Chapter ${chapter.number}`}
                disabled={!editable}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== (chapter.title ?? ""))
                    patch({ title: value || null });
                }}
              />
              <div className="kdp-editor-meta">
                <span>
                  {formatWords(words)} / {formatWords(chapter.targetWords)}{" "}
                  words
                </span>
                <Pill
                  tone={
                    chapter.status === "approved"
                      ? "good"
                      : chapter.locked
                        ? "warn"
                        : "neutral"
                  }
                >
                  {chapter.status === "approved"
                    ? "Approved"
                    : chapter.locked
                      ? "Locked"
                      : chapter.status}
                </Pill>
                <span
                  className={`kdp-saved${saveState.kind === "error" || saveState.kind === "conflict" ? " error" : dirty ? " dirty" : ""}`}
                  aria-live="polite"
                >
                  {saveState.kind === "saving"
                    ? "Saving…"
                    : saveState.kind === "error" ||
                        saveState.kind === "conflict"
                      ? saveState.message
                      : dirty
                        ? "Unsaved"
                        : (saveState.message ??
                          `Revision ${chapter.revisionCount}`)}
                </span>
              </div>
              <div className="kdp-actions">
                <button
                  type="button"
                  className="button primary small"
                  disabled={!editable || saveState.kind === "saving"}
                  onClick={() => void save("manual")}
                  title="Save a revision (⌘S)"
                >
                  <Save size={14} /> Save
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => patch({ locked: !chapter.locked })}
                >
                  {chapter.locked ? <LockOpen size={14} /> : <Lock size={14} />}{" "}
                  {chapter.locked ? "Unlock" : "Lock"}
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  disabled={chapter.wordCount === 0}
                  onClick={() =>
                    patch({ approved: chapter.status !== "approved" })
                  }
                >
                  <BadgeCheck size={14} />{" "}
                  {chapter.status === "approved" ? "Unapprove" : "Approve"}
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  disabled={!editable || draftRunning}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Redraft chapter ${chapter.number} with AI? The current text stays in its history.`,
                      )
                    ) {
                      job({
                        kind: "draft",
                        chapterIds: [chapter.id],
                        regenerate: true,
                      });
                    }
                  }}
                >
                  <RefreshCw size={14} /> Regenerate
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  disabled={chapter.wordCount === 0 || draftRunning || dirty}
                  title={
                    dirty
                      ? "Save first"
                      : "Check this chapter against the story bible"
                  }
                  onClick={() =>
                    job({
                      kind: "draft",
                      inspectOnly: true,
                      chapterIds: [chapter.id],
                    })
                  }
                >
                  <ScanSearch size={14} /> Check continuity
                </button>
                <a
                  className="button ghost small"
                  href={chapterExportUrl(bookId, chapter.id, "docx")}
                >
                  <Download size={14} /> DOCX
                </a>
                <a
                  className="button ghost small"
                  href={chapterExportUrl(bookId, chapter.id, "md")}
                >
                  <Download size={14} /> Markdown
                </a>
              </div>
            </div>
            {!editable && (
              <p className="notice">
                <Lock size={15} /> This chapter is{" "}
                {chapter.status === "approved" ? "approved" : "locked"}. Unlock
                {chapter.status === "approved" ? " or unapprove" : ""} it to
                edit; AI jobs never change it.
              </p>
            )}
            {externalChange && (
              <p className="notice error">
                <AlertTriangle size={15} /> This chapter changed elsewhere (for
                example a regeneration) while you have unsaved edits.
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => setAdopted(undefined)}
                >
                  Load the new version
                </button>
              </p>
            )}
            {saveState.kind === "conflict" && (
              <p className="notice error">
                <AlertTriangle size={15} /> {saveState.message}
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => {
                    setAdopted(undefined);
                    setSaved(content);
                    void chapterResource.reload();
                  }}
                >
                  Reload chapter
                </button>
              </p>
            )}
            {error && <p className="notice error">{error}</p>}
            <ManuscriptEditor
              key={`${chapter.id}:${editorVersion}`}
              initialMarkup={content}
              editable={editable}
              onChange={onChange}
              onSelection={setSelection}
              onReady={onReady}
              onSave={onSave}
            />
          </>
        ) : (
          <div className="kdp-prose kdp-prose-loading" aria-busy="true" />
        )}
      </section>

      <aside className="kdp-side-panel" aria-label="Chapter tools">
        <section className="kdp-ai-tools">
          <h3>
            <Sparkles size={15} /> AI on selected text
          </h3>
          {selection ? (
            <>
              <p className="kdp-muted">{selection.words} words selected.</p>
              <input
                aria-label="Optional instruction"
                placeholder="Optional instruction"
                value={instruction}
                maxLength={1000}
                onChange={(event) => setInstruction(event.target.value)}
              />
              <div className="kdp-ai-buttons">
                {operations.map((operation) => (
                  <button
                    type="button"
                    key={operation.id}
                    className="button ghost small"
                    disabled={!editable || aiBusy !== undefined}
                    onClick={() => runPassage(operation.id)}
                  >
                    {aiBusy === operation.id ? "Working…" : operation.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="kdp-muted">
              Select a passage in the chapter to rewrite, expand, improve
              dialogue, adjust pacing or fix grammar.
            </p>
          )}
        </section>

        <div className="segmented kdp-panel-tabs" role="tablist">
          {(
            [
              ["card", "Card", BookOpenText],
              ["bible", "Bible", Users],
              [
                "warnings",
                `Warnings${chapterIssues.length ? ` ${chapterIssues.length}` : ""}`,
                AlertTriangle,
              ],
              ["notes", "Notes", NotebookPen],
              ["history", "History", History],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={panel === id}
              className={panel === id ? "selected" : ""}
              onClick={() => setPanel(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {chapter && panel === "card" && (
          <div className="kdp-panel-body">
            <p>
              <strong>Viewpoint:</strong> {chapter.card.povCharacter} ·{" "}
              {chapter.card.location} · {chapter.card.time}
            </p>
            <p>
              <strong>Objective:</strong> {chapter.card.objective}
            </p>
            <p>
              <strong>Opening hook:</strong> {chapter.card.openingHook}
            </p>
            <ol>
              {chapter.card.scenes.map((scene, index) => (
                <li key={index}>{scene.summary}</li>
              ))}
            </ol>
            <p>
              <strong>Ending beat:</strong> {chapter.card.endingBeat}
            </p>
            {chapter.summary && (
              <p className="kdp-muted">
                <strong>Summary after inspection:</strong> {chapter.summary}
              </p>
            )}
          </div>
        )}

        {panel === "bible" && (
          <div className="kdp-panel-body">
            {characters.map((character) => (
              <details key={character.id} className="kdp-mini-entity">
                <summary>
                  {character.name} <small>{character.role}</small>
                </summary>
                <p>{character.description}</p>
                {character.physicalDetails && (
                  <p>Physical: {character.physicalDetails}</p>
                )}
                <p>Speech: {character.speechPattern}</p>
                {character.state && <p>Now: {character.state}</p>}
              </details>
            ))}
            {facts.length > 0 && (
              <>
                <h4>Established facts</h4>
                <ul className="kdp-plain-list">
                  {facts.slice(-40).map((fact) => (
                    <li key={fact.id}>
                      {fact.fact}{" "}
                      {fact.chapterNumber ? (
                        <small>(ch. {fact.chapterNumber})</small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Link
              href={`/kdp/books/${bookId}/bible`}
              className="button ghost small"
            >
              Open story bible
            </Link>
          </div>
        )}

        {panel === "warnings" && (
          <div className="kdp-panel-body">
            {chapterIssues.length === 0 ? (
              <p className="kdp-muted">
                No open continuity or style warnings for this chapter.
              </p>
            ) : (
              <ul className="kdp-warnings">
                {chapterIssues.map((issue) => (
                  <li key={issue.id}>
                    <Pill
                      tone={
                        issue.severity === "critical" ||
                        issue.severity === "major"
                          ? "bad"
                          : issue.severity === "minor"
                            ? "warn"
                            : "neutral"
                      }
                    >
                      {issue.severity}
                    </Pill>
                    <strong>{issue.issue}</strong>
                    <p>{issue.evidence}</p>
                    <small>{issue.suggestion}</small>
                    <div className="kdp-actions">
                      <button
                        type="button"
                        className="button ghost small"
                        onClick={() =>
                          void kdpSend(
                            kdpPath(bookId, `/editorial/issues/${issue.id}`),
                            "PATCH",
                            { status: "resolved", apply: false },
                          ).then(() => editorial.reload())
                        }
                      >
                        Mark resolved
                      </button>
                      <button
                        type="button"
                        className="button ghost small"
                        onClick={() =>
                          void kdpSend(
                            kdpPath(bookId, `/editorial/issues/${issue.id}`),
                            "PATCH",
                            { status: "rejected", apply: false },
                          ).then(() => editorial.reload())
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/kdp/books/${bookId}/editorial`}
              className="button ghost small"
            >
              All editorial issues
            </Link>
          </div>
        )}

        {chapter && panel === "notes" && (
          <div className="kdp-panel-body">
            <label className="field">
              <span>Author notes (not exported)</span>
              <textarea
                rows={10}
                value={notes ?? ""}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button secondary small"
              disabled={notes === (chapter.authorNotes ?? "")}
              onClick={() =>
                patch({ authorNotes: notes?.trim() ? notes : null })
              }
            >
              Save notes
            </button>
          </div>
        )}

        {panel === "history" && (
          <div className="kdp-panel-body">
            <ol className="kdp-revisions">
              {(revisions.data?.items ?? []).map((revision) => (
                <li
                  key={revision.id}
                  className={compare?.id === revision.id ? "active" : ""}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setCompare(
                        compare?.id === revision.id ? undefined : revision,
                      )
                    }
                  >
                    <strong>
                      Revision {revision.revisionNumber} ·{" "}
                      {revisionLabels[revision.source]}
                    </strong>
                    <small>
                      {formatDateTime(revision.createdAt)} ·{" "}
                      {formatWords(revision.wordCount)} words
                    </small>
                    {revision.note && <small>{revision.note}</small>}
                  </button>
                </li>
              ))}
            </ol>
            {compare && chapter && (
              <div className="kdp-compare">
                <p className="kdp-muted">
                  Changes from revision {compare.revisionNumber} to the current
                  text (
                  {(() => {
                    const summary = changeSummary(
                      diffText(compare.content, content),
                    );
                    return `+${summary.added} / −${summary.removed} words`;
                  })()}
                  ).
                </p>
                <DiffView parts={diffText(compare.content, content)} />
                <button
                  type="button"
                  className="button secondary small"
                  disabled={!editable}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Restore revision ${compare.revisionNumber}? The current text is kept as a revision first.`,
                      )
                    )
                      return;
                    const restore = async () => {
                      if (dirty) await save("manual");
                      const result = await kdpSend<Chapter>(
                        kdpPath(
                          bookId,
                          `/chapters/${chapter.id}/revisions/${compare.id}/restore`,
                        ),
                        "POST",
                      );
                      chapterResource.setData(result);
                      setCompare(undefined);
                      void revisions.reload();
                      void list.reload();
                    };
                    restore().catch((reason: unknown) =>
                      setError(errorMessage(reason)),
                    );
                  }}
                >
                  Restore this revision
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {suggestion && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="AI suggestion"
        >
          <div className="story-modal kdp-suggestion">
            <header>
              <div>
                <h2>
                  {
                    operations.find((item) => item.id === suggestion.operation)
                      ?.label
                  }
                </h2>
                <p className="kdp-muted">
                  Cost {formatUsd(suggestion.costMicros)}. Nothing changes until
                  you accept.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close"
                onClick={() => setSuggestion(null)}
              >
                <X size={16} />
              </button>
            </header>
            <DiffView
              parts={diffText(suggestion.original, suggestion.replacement)}
            />
            <footer className="kdp-actions">
              <button
                type="button"
                className="button primary"
                onClick={acceptSuggestion}
              >
                Accept
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => setSuggestion(null)}
              >
                Reject
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChaptersPage() {
  return (
    <Suspense fallback={<div className="kdp-card" aria-busy="true" />}>
      <ChapterWorkspace />
    </Suspense>
  );
}
