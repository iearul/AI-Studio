"use client";

import type {
  Project,
  StoryPlan,
  StoryPlanInput,
} from "@ai-film-studio/contracts";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileJson,
  Film,
  Layers3,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

type StoryRequest = { filename: string; prompt: string };
type Modal = "export" | "import" | null;

export default function StoryWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project>();
  const [plan, setPlan] = useState<StoryPlan | null>();
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const [request, setRequest] = useState<StoryRequest>();
  const [importText, setImportText] = useState("");
  const [preview, setPreview] = useState<StoryPlanInput>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiFetch<Project>(`/projects/${id}`),
      apiFetch<{ plan: StoryPlan | null }>(`/projects/${id}/story-plan`),
    ])
      .then(([nextProject, response]) => {
        if (cancelled) return;
        setProject(nextProject);
        setPlan(response.plan);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not open the story workspace.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const previewTotals = useMemo(() => {
    if (!preview) return undefined;
    const shots = preview.scenes.flatMap((scene) => scene.shots);
    return {
      scenes: preview.scenes.length,
      shots: shots.length,
      duration: shots.reduce((total, shot) => total + shot.durationSeconds, 0),
    };
  }, [preview]);

  async function openExport() {
    setBusy(true);
    setError(undefined);
    try {
      setRequest(await apiFetch<StoryRequest>(`/projects/${id}/story-request`));
      setModal("export");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not build the request.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyRequest() {
    if (!request) return;
    await navigator.clipboard.writeText(request.prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function downloadRequest() {
    if (!request) return;
    const url = URL.createObjectURL(
      new Blob([request.prompt], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = request.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function openImport() {
    setPreview(undefined);
    setError(undefined);
    setModal("import");
  }

  async function validateImport() {
    setBusy(true);
    setError(undefined);
    try {
      const parsed = JSON.parse(importText) as unknown;
      const response = await apiFetch<{ valid: true; plan: StoryPlanInput }>(
        `/projects/${id}/story-plan/validate`,
        { method: "POST", body: JSON.stringify(parsed) },
      );
      setPreview(response.plan);
    } catch (reason) {
      if (reason instanceof SyntaxError) {
        setError("The pasted response is not valid JSON.");
      } else if (reason instanceof ApiError && reason.problem?.errors) {
        setError(Object.values(reason.problem.errors).flat().join(" "));
      } else {
        setError(
          reason instanceof Error
            ? reason.message
            : "The story plan could not be validated.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function importPlan() {
    if (!preview) return;
    if (
      plan &&
      !window.confirm(
        "Replace the current story plan? Existing story, scenes, and shots will be superseded.",
      )
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await apiFetch<StoryPlan>(`/projects/${id}/story-plan`, {
        method: "PUT",
        body: JSON.stringify(preview),
      });
      setPlan(saved);
      setModal(null);
      setPreview(undefined);
      setImportText("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The story plan could not be imported.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <div className="page">
        <div className="project-detail-skeleton" />
      </div>
    );
  if (!project || (error && !modal))
    return (
      <div className="page">
        <div className="notice error">
          <strong>Story workspace unavailable</strong>
          <span>{error ?? "Project not found."}</span>
        </div>
      </div>
    );

  return (
    <div className="page story-page">
      <Link className="back-link" href={`/projects/${project.id}`}>
        <ArrowLeft size={16} /> {project.title}
      </Link>
      <header className="story-heading">
        <div>
          <span className="eyebrow">
            <BookOpen size={14} /> Story room
          </span>
          <h1>{plan?.story.title ?? "Build the story plan."}</h1>
          <p>
            {plan?.story.logline ??
              "Use ChatGPT manually, review the structured result, then import it before any generation begins."}
          </p>
        </div>
        <div className="story-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void openExport()}
          >
            <Download size={16} /> Export request
          </button>
          <button className="button primary" onClick={openImport}>
            <Upload size={16} /> {plan ? "Replace plan" : "Import JSON"}
          </button>
        </div>
      </header>

      {!plan ? (
        <section className="story-empty">
          <div className="story-empty-art">
            <span>IDEA</span>
            <i />
            <span>STORY</span>
            <i />
            <span>SHOTS</span>
          </div>
          <div>
            <span className="eyebrow">
              <Sparkles size={14} /> Manual AI workflow
            </span>
            <h2>Keep creative control between every step.</h2>
            <ol>
              <li>
                <strong>Export</strong> the tailored story request.
              </li>
              <li>Use it in ChatGPT and copy the JSON response.</li>
              <li>
                <strong>Validate &amp; review</strong> scene, shot, and duration
                totals.
              </li>
              <li>Import only when the plan is worth keeping.</li>
            </ol>
            <button
              className="button primary"
              onClick={() => void openExport()}
            >
              Export first request <Download size={16} />
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="plan-metrics">
            <div>
              <Layers3 size={18} />
              <span>
                <strong>{plan.totals.scenes}</strong> scenes
              </span>
            </div>
            <div>
              <Film size={18} />
              <span>
                <strong>{plan.totals.shots}</strong> shots
              </span>
            </div>
            <div>
              <Clock3 size={18} />
              <span>
                <strong>{plan.totals.shotDurationSeconds}s</strong> planned
              </span>
            </div>
            <div className="plan-version">
              <CheckCircle2 size={17} /> Story v{plan.story.version} · Manifest
              synced
            </div>
          </section>

          {project.type === "reel" && (
            <section className="reel-beats">
              <article>
                <small>0–3 seconds</small>
                <h3>Hook</h3>
                <p>{plan.story.hook || "Not specified"}</p>
              </article>
              <article>
                <small>Reveal</small>
                <h3>Twist</h3>
                <p>{plan.story.twist || "Not specified"}</p>
              </article>
              <article>
                <small>Final beat</small>
                <h3>Cliffhanger</h3>
                <p>{plan.story.cliffhanger || "Not specified"}</p>
              </article>
            </section>
          )}

          <section className="story-arc-panel">
            <div className="section-heading">
              <div>
                <h2>Story arc</h2>
                <p>
                  {plan.story.theme} · {plan.story.tone}
                </p>
              </div>
              <span className="genre-pill">{plan.story.genre}</span>
            </div>
            <div className="arc-grid">
              {[
                ["Beginning", plan.story.beginning],
                ["Middle", plan.story.middle],
                ["Climax", plan.story.climax],
                ["Ending", plan.story.ending],
              ].map(([label, value], index) => (
                <article key={label}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{label}</h3>
                  <p>{value}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="scene-section">
            <div className="section-heading">
              <div>
                <h2>Screenplay &amp; shot plan</h2>
                <p>
                  {plan.script.title} · version {plan.script.version}
                </p>
              </div>
            </div>
            <div className="scene-list">
              {plan.scenes.map((scene) => (
                <article className="scene-card" key={scene.id}>
                  <header>
                    <span>
                      SCENE {String(scene.sceneNumber).padStart(2, "0")}
                    </span>
                    <div>
                      <h3>{scene.location}</h3>
                      <p>
                        {scene.timeOfDay} ·{" "}
                        {scene.characters.join(", ") || "No characters"}
                      </p>
                    </div>
                    <strong>{scene.estimatedDurationSeconds}s</strong>
                  </header>
                  <div className="scene-copy">
                    <div>
                      <small>Action</small>
                      <p>{scene.action}</p>
                    </div>
                    {scene.narration && (
                      <div>
                        <small>Narration</small>
                        <p>{scene.narration}</p>
                      </div>
                    )}
                    {scene.dialogue && (
                      <div>
                        <small>Dialogue</small>
                        <p>{scene.dialogue}</p>
                      </div>
                    )}
                  </div>
                  <div className="shot-table">
                    {scene.shots.map((shot) => (
                      <div className="shot-row" key={shot.id}>
                        <span className="shot-code">{shot.code}</span>
                        <div>
                          <strong>{shot.action}</strong>
                          <small>
                            {shot.shotType} · {shot.cameraAngle} · {shot.lens} ·{" "}
                            {shot.cameraMovement}
                          </small>
                        </div>
                        <span>{shot.durationSeconds}s</span>
                        <span className={`status ${shot.status}`}>
                          {shot.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {modal && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="story-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="story-modal-title"
          >
            <header>
              <span className="settings-icon">
                {modal === "export" ? (
                  <Download size={19} />
                ) : (
                  <FileJson size={19} />
                )}
              </span>
              <div>
                <h2 id="story-modal-title">
                  {modal === "export"
                    ? "Story request"
                    : "Import structured JSON"}
                </h2>
                <p>
                  {modal === "export"
                    ? "Paste this into ChatGPT. It contains the brief, constraints, and exact schema."
                    : "Nothing is saved until validation succeeds and you choose Import plan."}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => {
                  setModal(null);
                  setError(undefined);
                }}
              >
                <X size={19} />
              </button>
            </header>
            {modal === "export" && request && (
              <>
                <textarea
                  className="code-area"
                  readOnly
                  value={request.prompt}
                  aria-label="Story request prompt"
                />
                <footer>
                  <span>{request.filename}</span>
                  <button
                    className="button secondary"
                    onClick={downloadRequest}
                  >
                    <Download size={15} /> Download
                  </button>
                  <button
                    className="button primary"
                    onClick={() => void copyRequest()}
                  >
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                    {copied ? "Copied" : "Copy request"}
                  </button>
                </footer>
              </>
            )}
            {modal === "import" && (
              <>
                {!preview ? (
                  <>
                    <textarea
                      className="code-area import-area"
                      value={importText}
                      onChange={(event) => setImportText(event.target.value)}
                      placeholder='Paste the JSON response here, beginning with { "story": ... }'
                      aria-label="Story plan JSON"
                    />
                    {error && (
                      <div className="notice error">
                        <strong>Validation failed</strong>
                        <span>{error}</span>
                      </div>
                    )}
                    <footer>
                      <span>
                        JSON is validated locally by the Film Studio API.
                      </span>
                      <button
                        className="button primary"
                        disabled={busy || importText.trim().length === 0}
                        onClick={() => void validateImport()}
                      >
                        {busy ? "Validating…" : "Validate & review"}
                      </button>
                    </footer>
                  </>
                ) : (
                  <>
                    <div className="import-preview">
                      <span className="preview-check">
                        <CheckCircle2 size={26} />
                      </span>
                      <h3>Valid structure</h3>
                      <p>{preview.story.logline}</p>
                      <div>
                        <span>
                          <strong>{previewTotals?.scenes}</strong> scenes
                        </span>
                        <span>
                          <strong>{previewTotals?.shots}</strong> shots
                        </span>
                        <span>
                          <strong>{previewTotals?.duration}s</strong> duration
                        </span>
                      </div>
                      {project &&
                        previewTotals &&
                        Math.abs(
                          previewTotals.duration -
                            project.targetDurationSeconds,
                        ) >
                          project.targetDurationSeconds * 0.2 && (
                          <div className="duration-warning">
                            Planned shots differ from the{" "}
                            {project.targetDurationSeconds}s target by more than
                            20%. Review before importing.
                          </div>
                        )}
                    </div>
                    {error && (
                      <div className="notice error">
                        <span>{error}</span>
                      </div>
                    )}
                    <footer>
                      <button
                        className="button secondary"
                        onClick={() => setPreview(undefined)}
                      >
                        Back to JSON
                      </button>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => void importPlan()}
                      >
                        {busy ? "Importing…" : "Import plan"}
                      </button>
                    </footer>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
