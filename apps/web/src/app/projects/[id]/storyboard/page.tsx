"use client";

import type {
  ImageAttempt,
  ImageHistory,
  Project,
  ReferenceCoverage,
  ReferenceImage,
  ShotReferenceContext,
} from "@ai-film-studio/contracts";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  ImagePlus,
  LoaderCircle,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  type ClipboardEvent,
  type DragEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { apiBaseUrl, apiFetch } from "@/lib/api";

const referencePreference = [
  "three-quarter",
  "front",
  "full-body",
  "neutral",
  "interior",
  "exterior-day",
  "profile",
  "detail",
  "expression",
  "exterior-night",
  "other",
];

function recommendedReferences(shot: ShotReferenceContext): Array<{
  entityName: string;
  reference: ReferenceImage;
}> {
  const entities = [
    ...shot.characters,
    ...(shot.location ? [shot.location] : []),
    ...shot.props,
  ];
  return entities.flatMap((entity) => {
    const reference = [...entity.references].sort(
      (left, right) =>
        referencePreference.indexOf(left.view) -
        referencePreference.indexOf(right.view),
    )[0];
    return reference ? [{ entityName: entity.name, reference }] : [];
  });
}

export default function StoryboardPage() {
  return (
    <Suspense fallback={<StoryboardSkeleton />}>
      <StoryboardWorkspace />
    </Suspense>
  );
}

function StoryboardSkeleton() {
  return (
    <div className="page">
      <div className="project-detail-skeleton" />
    </div>
  );
}

function StoryboardWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project>();
  const [coverage, setCoverage] = useState<ReferenceCoverage>();
  const [history, setHistory] = useState<ImageHistory>();
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [busy, setBusy] = useState<string>();
  const [copiedShot, setCopiedShot] = useState<string>();
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [nextProject, nextCoverage, nextHistory] = await Promise.all([
      apiFetch<Project>(`/projects/${id}`),
      apiFetch<ReferenceCoverage>(`/projects/${id}/reference-coverage`),
      apiFetch<ImageHistory>(`/projects/${id}/image-history`),
    ]);
    setProject(nextProject);
    setCoverage(nextCoverage);
    setHistory(nextHistory);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void load().catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not open the storyboard workspace.",
          );
        }
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [load]);

  const attemptsByShot = useMemo(() => {
    const grouped = new Map<string, ImageAttempt[]>();
    for (const attempt of history?.attempts ?? []) {
      grouped.set(attempt.shotId, [
        ...(grouped.get(attempt.shotId) ?? []),
        attempt,
      ]);
    }
    return grouped;
  }, [history]);

  async function copyPrompt(shotId: string, prompt: string) {
    setError("");
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedShot(shotId);
      window.setTimeout(() => setCopiedShot(undefined), 1500);
    } catch {
      setError(
        "The prompt could not be copied. Please copy it from the Visual Bible.",
      );
    }
  }

  async function importFrame(shotId: string) {
    const file = files[shotId];
    if (!file) return;
    setBusy(`import-${shotId}`);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      await apiFetch(`/projects/${id}/shots/${shotId}/image-imports`, {
        method: "POST",
        body,
      });
      setFiles((current) => ({ ...current, [shotId]: undefined }));
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The storyboard frame could not be imported.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  function chooseFrame(shotId: string, candidate: File | undefined) {
    if (!candidate) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(candidate.type)) {
      setError("Use a PNG, JPEG, or WebP image.");
      return;
    }
    setError("");
    setFiles((current) => ({ ...current, [shotId]: candidate }));
  }

  function dropFrame(shotId: string, event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    chooseFrame(shotId, event.dataTransfer.files[0]);
  }

  function pasteFrame(shotId: string, event: ClipboardEvent<HTMLLabelElement>) {
    const candidate = [...event.clipboardData.items]
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();
    if (!candidate) {
      setError("The clipboard does not contain an image.");
      return;
    }
    event.preventDefault();
    chooseFrame(shotId, candidate);
  }

  async function review(attemptId: string, decision: "approve" | "reject") {
    setBusy(`${decision}-${attemptId}`);
    setError("");
    try {
      await apiFetch(`/projects/${id}/image-attempts/${attemptId}/review`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Review could not be saved.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  if (!project || !coverage || !history) {
    return error ? (
      <div className="page">
        <div className="notice error">
          <strong>Storyboard unavailable</strong>
          <span>{error}</span>
        </div>
      </div>
    ) : (
      <StoryboardSkeleton />
    );
  }

  return (
    <div className="page storyboard-page">
      <Link className="back-link" href={`/projects/${project.id}`}>
        <ArrowLeft size={16} /> {project.title}
      </Link>
      <header className="storyboard-heading">
        <div>
          <span className="eyebrow">
            <Sparkles size={14} /> Image production
          </span>
          <h1>Storyboard review</h1>
          <p>
            Copy each continuity-safe prompt into ChatGPT or Gemini, paste or
            drop the generated alternatives here, and approve one frame per
            shot.
          </p>
        </div>
        <div className="storyboard-metrics">
          <span>
            <strong>{history.totals.approved}</strong> approved
          </span>
          <span>
            <strong>{history.totals.attempts}</strong> attempts
          </span>
          <span>
            <strong>{history.totals.failed}</strong> failed
          </span>
        </div>
      </header>

      <section className="provider-banner online">
        <span className="provider-icon">
          <ImagePlus size={20} />
        </span>
        <div>
          <strong>ChatGPT / Gemini image workflow</strong>
          <p>
            Copy the prepared prompt, create the image externally, then paste,
            drop, or choose it here. AI Film Studio does not run a local image
            model.
          </p>
          <small>No local image-model memory usage</small>
        </div>
        <span className="provider-state">
          <CheckCircle2 size={14} /> Manual
        </span>
      </section>

      {error && (
        <div className="notice error storyboard-notice">
          <AlertTriangle size={16} /> <span>{error}</span>
        </div>
      )}

      {coverage.shots.length === 0 ? (
        <div className="storyboard-empty">
          <ImagePlus size={26} />
          <h2>No shots to storyboard</h2>
          <p>Import a structured story plan before producing frames.</p>
          <Link className="button primary" href={`/projects/${id}/story`}>
            Open story plan
          </Link>
        </div>
      ) : (
        <div className="storyboard-shot-list">
          {coverage.shots.map((shot) => {
            const attempts = attemptsByShot.get(shot.shotId) ?? [];
            const selected = attempts.find((attempt) => attempt.selected);
            const suggestedReferences = recommendedReferences(shot);
            const action =
              shot.prompt
                .split("\n")
                .find((line) => line.startsWith("ACTION: "))
                ?.slice("ACTION: ".length) ?? "Storyboard frame";
            const context = [
              shot.characters.map((item) => item.name).join(", "),
              shot.location?.name,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <section className="storyboard-shot" key={shot.shotId}>
                <header>
                  <div className="shot-identity">
                    <span>{shot.shotCode}</span>
                    <div>
                      <h2>{action}</h2>
                      <p>{context || "No continuity subjects"}</p>
                    </div>
                  </div>
                  <span
                    className={`shot-readiness ${shot.ready ? "ready" : "blocked"}`}
                  >
                    {shot.ready ? <Check size={13} /> : <X size={13} />}
                    {shot.ready ? "References resolved" : "Continuity blocked"}
                  </span>
                </header>

                {shot.warnings.length > 0 && (
                  <div className="shot-warning-row">
                    {shot.warnings.map((warning) => (
                      <span key={warning}>{warning}</span>
                    ))}
                  </div>
                )}

                {suggestedReferences.length > 0 && (
                  <div className="shot-reference-strip">
                    <strong>Recommended continuity photos to attach</strong>
                    <div>
                      {suggestedReferences.map(({ entityName, reference }) => (
                        <figure key={reference.id}>
                          <Image
                            unoptimized
                            width={62}
                            height={62}
                            src={`${apiBaseUrl}/projects/${project.id}/references/${reference.id}/content`}
                            alt={`${entityName} ${reference.view} reference`}
                          />
                          <figcaption>
                            {entityName}
                            <small>{reference.view.replaceAll("-", " ")}</small>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                )}

                <div className="storyboard-controls">
                  <button
                    className="button primary"
                    disabled={!shot.ready || Boolean(busy)}
                    onClick={() => void copyPrompt(shot.shotId, shot.prompt)}
                  >
                    {copiedShot === shot.shotId ? (
                      <Check size={15} />
                    ) : (
                      <Copy size={15} />
                    )}
                    {copiedShot === shot.shotId
                      ? "Prompt copied"
                      : "Copy image prompt"}
                  </button>
                  <label
                    className="storyboard-file"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropFrame(shot.shotId, event)}
                    onPaste={(event) => pasteFrame(shot.shotId, event)}
                    tabIndex={shot.ready && !busy ? 0 : -1}
                  >
                    <Upload size={15} />
                    <span>
                      {files[shot.shotId]?.name ??
                        "Choose, drop, or paste frame"}
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={!shot.ready || Boolean(busy)}
                      onChange={(event) =>
                        chooseFrame(shot.shotId, event.target.files?.[0])
                      }
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={
                      !files[shot.shotId] || !shot.ready || Boolean(busy)
                    }
                    onClick={() => void importFrame(shot.shotId)}
                  >
                    {busy === `import-${shot.shotId}` ? (
                      <LoaderCircle className="spinner" size={15} />
                    ) : (
                      <ImagePlus size={15} />
                    )}
                    Import for review
                  </button>
                </div>

                {attempts.length === 0 ? (
                  <div className="attempts-empty">
                    No attempts yet. Create an image in ChatGPT with the copied
                    prompt, then import it above.
                  </div>
                ) : (
                  <div className="attempt-grid">
                    {attempts.map((attempt) => (
                      <article
                        className={`attempt-card ${attempt.selected ? "selected" : ""}`}
                        key={attempt.id}
                      >
                        <div className="attempt-image">
                          {attempt.asset ? (
                            <Image
                              unoptimized
                              fill
                              sizes="(max-width: 640px) 100vw, 340px"
                              src={`${apiBaseUrl}/projects/${project.id}/assets/${attempt.asset.id}/content`}
                              alt={`${shot.shotCode} ${attempt.provider} attempt`}
                            />
                          ) : (
                            <span>
                              {attempt.status === "failed" ? (
                                <AlertTriangle size={24} />
                              ) : (
                                <LoaderCircle className="spinner" size={24} />
                              )}
                              {attempt.status === "queued"
                                ? "Queued"
                                : attempt.status === "generating"
                                  ? `${attempt.job?.progress ?? 0}%`
                                  : "No preview"}
                            </span>
                          )}
                          <i className={`attempt-status ${attempt.status}`}>
                            {attempt.status}
                          </i>
                          {attempt.selected && (
                            <b>
                              <CheckCircle2 size={13} /> Selected
                            </b>
                          )}
                        </div>
                        <div className="attempt-body">
                          <div className="attempt-title">
                            <strong>
                              {attempt.provider === "manual"
                                ? "Manual import"
                                : "Legacy local attempt"}
                            </strong>
                            <small>
                              {new Date(attempt.createdAt).toLocaleString()}
                            </small>
                          </div>
                          <div className="attempt-facts">
                            <span>
                              Seed <b>{attempt.seed ?? "—"}</b>
                            </span>
                            <span>
                              Time{" "}
                              <b>{formatDuration(attempt.generationTimeMs)}</b>
                            </span>
                            <span>
                              Cost{" "}
                              <b>
                                {formatCost(
                                  attempt.costMicros,
                                  attempt.currency,
                                )}
                              </b>
                            </span>
                          </div>
                          {attempt.errorMessage && (
                            <p className="attempt-error">
                              {attempt.errorMessage}
                            </p>
                          )}
                          {attempt.asset && (
                            <div className="attempt-review">
                              <button
                                className="button approve"
                                disabled={Boolean(busy) || attempt.selected}
                                onClick={() =>
                                  void review(attempt.id, "approve")
                                }
                              >
                                <Check size={14} />{" "}
                                {attempt.selected ? "Approved" : "Approve"}
                              </button>
                              <button
                                className="button reject"
                                disabled={
                                  Boolean(busy) ||
                                  attempt.reviewStatus === "rejected"
                                }
                                onClick={() =>
                                  void review(attempt.id, "reject")
                                }
                              >
                                <X size={14} />{" "}
                                {attempt.reviewStatus === "rejected"
                                  ? "Rejected"
                                  : "Reject"}
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {selected && (
                  <footer className="selected-summary">
                    <CheckCircle2 size={16} /> Approved frame locked for{" "}
                    {shot.shotCode}
                  </footer>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function formatCost(micros: number, currency: string): string {
  if (micros === 0) return "€0.00";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(micros / 1_000_000);
}
