"use client";

import type {
  Project,
  VideoAttempt,
  VideoProviderId,
  VideoProviderModel,
  VideoProviderStatus,
  VideoResolution,
  VideoShotPlan,
  VideoWorkspace,
} from "@ai-film-studio/contracts";
import { paidVideoConfirmation } from "@ai-film-studio/contracts";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Film,
  ImageIcon,
  LoaderCircle,
  Play,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  type ClipboardEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useLightbox } from "@/components/image-lightbox";
import { apiBaseUrl, apiFetch, formatBytes } from "@/lib/api";

type ProviderChoice = "manual" | VideoProviderId;

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project>();
  const [workspace, setWorkspace] = useState<VideoWorkspace>();
  const [providers, setProviders] = useState<Record<string, ProviderChoice>>(
    {},
  );
  const [resolutions, setResolutions] = useState<
    Record<string, VideoResolution>
  >({});
  const [models, setModels] = useState<Record<string, string>>({});
  const [audio, setAudio] = useState<Record<string, boolean>>({});
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [busy, setBusy] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lightbox = useLightbox();

  const load = useCallback(async () => {
    const [nextProject, nextWorkspace] = await Promise.all([
      apiFetch<Project>(`/projects/${id}`),
      apiFetch<VideoWorkspace>(`/projects/${id}/video-workspace`),
    ]);
    setProject(nextProject);
    setWorkspace(nextWorkspace);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void load().catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not open the video workspace.",
          );
        }
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [load]);

  useEffect(() => {
    if (!workspace?.totals.active) return;
    const interval = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(interval);
  }, [load, workspace?.totals.active]);

  const providerMap = useMemo(
    () =>
      new Map(
        (workspace?.providers ?? []).map((provider) => [provider.id, provider]),
      ),
    [workspace?.providers],
  );

  function selectedProvider(shotId: string): ProviderChoice {
    return providers[shotId] ?? "manual";
  }

  function selectedModel(
    shotId: string,
    provider: VideoProviderStatus,
  ): VideoProviderModel {
    return (
      provider.models.find((model) => model.id === models[shotId]) ??
      provider.models.find((model) => model.id === provider.defaultModel) ??
      provider.models[0]!
    );
  }

  function selectedResolution(
    shotId: string,
    model: VideoProviderModel,
  ): VideoResolution {
    const selected = resolutions[shotId];
    return selected && model.supportedResolutions.includes(selected)
      ? selected
      : model.supportedResolutions[0]!;
  }

  async function copyPrompt(shot: VideoShotPlan) {
    setError("");
    try {
      await navigator.clipboard.writeText(shot.prompt);
      setCopied(shot.shotId);
      window.setTimeout(() => setCopied(undefined), 1500);
    } catch {
      setError("The prompt could not be copied. Select it below and copy it.");
    }
  }

  function chooseVideo(shotId: string, candidate: File | undefined) {
    if (!candidate) return;
    if (
      !["video/mp4", "video/quicktime", "video/webm"].includes(candidate.type)
    ) {
      setError("Use an MP4, MOV, or WebM video.");
      return;
    }
    if (candidate.size > 512 * 1024 * 1024) {
      setError("Videos may be at most 512 MB.");
      return;
    }
    setError("");
    setFiles((current) => ({ ...current, [shotId]: candidate }));
  }

  function dropVideo(shotId: string, event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    chooseVideo(shotId, event.dataTransfer.files[0]);
  }

  function pasteVideo(shotId: string, event: ClipboardEvent<HTMLLabelElement>) {
    const candidate = [...event.clipboardData.items]
      .find((item) => item.kind === "file" && item.type.startsWith("video/"))
      ?.getAsFile();
    if (!candidate) {
      setError("The clipboard does not contain an MP4, MOV, or WebM video.");
      return;
    }
    event.preventDefault();
    chooseVideo(shotId, candidate);
  }

  async function importVideo(shotId: string) {
    const file = files[shotId];
    if (!file) return;
    setBusy(`import-${shotId}`);
    setError("");
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      await apiFetch(`/projects/${id}/shots/${shotId}/video-imports`, {
        method: "POST",
        body,
      });
      setFiles((current) => ({ ...current, [shotId]: undefined }));
      setMessage("Video imported. Review and approve it below.");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The video could not be imported.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function generateCloud(
    shot: VideoShotPlan,
    providerId: VideoProviderId,
  ) {
    const provider = providerMap.get(providerId);
    if (!provider) return;
    const model = selectedModel(shot.shotId, provider);
    const duration = providerDuration(shot.durationSeconds, model);
    if (duration === null) return;
    const resolution = selectedResolution(shot.shotId, model);
    const generateAudio =
      model.supportsNativeAudio && Boolean(audio[shot.shotId]);
    const rate = generateAudio
      ? model.estimatedUsdPerSecond.withAudio[resolution]
      : model.estimatedUsdPerSecond.withoutAudio[resolution];
    const estimatedCost =
      rate === null
        ? "Unknown — check the provider console before continuing"
        : formatUsd(rate * duration);
    const accepted = window.confirm(
      [
        `${provider.label} is a paid cloud generation.`,
        "",
        `Shot: ${shot.shotCode}`,
        `Model: ${model.label}`,
        `Provider duration: ${duration} seconds`,
        `Resolution: ${resolution}`,
        `Estimated charge: ${estimatedCost}`,
        generateAudio ? "Native audio: on" : "Native audio: off",
        "Continuity: approved storyboard image attached as first_frame",
        "",
        model.pricingMessage,
        "Submission may spend provider credit and cannot be undone.",
      ].join("\n"),
    );
    if (!accepted) return;
    setBusy(`generate-${shot.shotId}`);
    setError("");
    setMessage("");
    try {
      await apiFetch(`/projects/${id}/shots/${shot.shotId}/video-generations`, {
        method: "POST",
        body: JSON.stringify({
          provider: providerId,
          model: model.id,
          resolution,
          generateAudio,
          confirmation: paidVideoConfirmation,
        }),
      });
      setMessage(
        `${model.label} accepted the task with the approved image attached as its first frame. The app will poll it and save the finished video locally.`,
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The cloud video could not be submitted.",
      );
      await load().catch(() => undefined);
    } finally {
      setBusy(undefined);
    }
  }

  async function refreshAttempt(attempt: VideoAttempt) {
    setBusy(`refresh-${attempt.id}`);
    setError("");
    try {
      await apiFetch(`/projects/${id}/video-attempts/${attempt.id}/refresh`, {
        method: "POST",
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The provider status could not be refreshed.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function review(attemptId: string, decision: "approve" | "reject") {
    setBusy(`${decision}-${attemptId}`);
    setError("");
    try {
      await apiFetch(`/projects/${id}/video-attempts/${attemptId}/review`, {
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

  if (!project || !workspace) {
    return error ? (
      <div className="page">
        <div className="notice error">
          <strong>Video workspace unavailable</strong>
          <span>{error}</span>
        </div>
      </div>
    ) : (
      <div className="page">
        <div className="project-detail-skeleton" />
      </div>
    );
  }

  return (
    <div className="page video-page">
      <Link className="back-link" href={`/projects/${project.id}`}>
        <ArrowLeft size={16} /> {project.title}
      </Link>
      <header className="storyboard-heading">
        <div>
          <span className="eyebrow">
            <Film size={14} /> Image-to-video production
          </span>
          <h1>Video workspace</h1>
          <p>
            Start from each approved storyboard photo. Use the prepared prompt
            manually, or submit it to Kling or Seedance after reviewing the
            provider charge.
          </p>
        </div>
        <div className="storyboard-metrics">
          <span>
            <strong>{workspace.totals.approved}</strong> approved
          </span>
          <span>
            <strong>{workspace.totals.active}</strong> active
          </span>
          <span>
            <strong>{workspace.totals.attempts}</strong> attempts
          </span>
        </div>
      </header>

      <div className="video-provider-grid">
        <section className="provider-banner online">
          <span className="provider-icon">
            <Upload size={20} />
          </span>
          <div>
            <strong>Manual ChatGPT / browser workflow</strong>
            <p>
              Copy the prompt, use the recommended frame, and import the result.
            </p>
            <small>No automatic provider charge</small>
          </div>
          <span className="provider-state">
            <CheckCircle2 size={14} /> Ready
          </span>
        </section>
        {workspace.providers.map((provider) => (
          <ProviderBanner provider={provider} key={provider.id} />
        ))}
      </div>

      {message && (
        <div className="notice success video-notice" role="status">
          <CheckCircle2 size={16} /> <span>{message}</span>
        </div>
      )}
      {error && (
        <div className="notice error video-notice" role="alert">
          <AlertTriangle size={16} /> <span>{error}</span>
        </div>
      )}

      {workspace.shots.length === 0 ? (
        <div className="storyboard-empty">
          <Film size={26} />
          <h2>No shots to animate</h2>
          <p>Create and import a story plan first.</p>
          <Link className="button primary" href={`/projects/${id}/story`}>
            Open story room
          </Link>
        </div>
      ) : (
        <div className="video-shot-list">
          {workspace.shots.map((shot) => {
            const choice = selectedProvider(shot.shotId);
            const provider =
              choice === "manual" ? undefined : providerMap.get(choice);
            const model = provider
              ? selectedModel(shot.shotId, provider)
              : undefined;
            const active = shot.attempts.find((attempt) =>
              ["submitting", "submitted", "processing", "downloading"].includes(
                attempt.status,
              ),
            );
            return (
              <section className="video-shot" key={shot.shotId}>
                <header>
                  <div className="shot-identity">
                    <span>{shot.shotCode}</span>
                    <div>
                      <h2>{shot.action}</h2>
                      <p>
                        {shot.durationSeconds}s ·{" "}
                        {shot.cameraMovement.replaceAll("-", " ")}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`shot-readiness ${shot.sourceImageAsset ? "ready" : "blocked"}`}
                  >
                    {shot.sourceImageAsset ? (
                      <Check size={13} />
                    ) : (
                      <X size={13} />
                    )}
                    {shot.sourceImageAsset
                      ? "Approved first frame"
                      : "Approve a storyboard first"}
                  </span>
                </header>

                <div className="video-shot-workspace">
                  <div className="video-source-panel">
                    <strong>Recommended first frame</strong>
                    {shot.sourceImageAsset ? (
                      <button
                        type="button"
                        className="video-source-image zoomable"
                        aria-label={`Enlarge the approved first frame for ${shot.shotCode}`}
                        onClick={() =>
                          lightbox.open([
                            {
                              src: `${apiBaseUrl}/projects/${id}/assets/${shot.sourceImageAsset!.id}/content`,
                              alt: `Approved first frame for ${shot.shotCode}`,
                              caption: `${shot.shotCode} · approved first frame`,
                            },
                          ])
                        }
                      >
                        <Image
                          unoptimized
                          fill
                          sizes="240px"
                          src={`${apiBaseUrl}/projects/${id}/assets/${shot.sourceImageAsset.id}/content`}
                          alt={`Approved first frame for ${shot.shotCode}`}
                        />
                        <span>
                          <ImageIcon size={13} /> Enlarge
                        </span>
                      </button>
                    ) : (
                      <Link
                        className="video-source-missing"
                        href={`/projects/${id}/storyboard`}
                      >
                        <ImageIcon size={24} />
                        <span>Open Storyboard and approve one image</span>
                      </Link>
                    )}
                  </div>

                  <div className="video-control-panel">
                    <label className="field">
                      <span>Generation mode</span>
                      <select
                        value={choice}
                        disabled={Boolean(active) || Boolean(busy)}
                        onChange={(event) =>
                          setProviders((current) => ({
                            ...current,
                            [shot.shotId]: event.target.value as ProviderChoice,
                          }))
                        }
                      >
                        <option value="manual">
                          Manual import — no API charge
                        </option>
                        {workspace.providers.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.label} —{" "}
                            {item.configured ? "connected" : "API key missing"}
                          </option>
                        ))}
                      </select>
                    </label>

                    {choice === "manual" ? (
                      <div className="manual-video-controls">
                        <button
                          className="button primary"
                          disabled={!shot.sourceImageAsset || Boolean(busy)}
                          onClick={() => void copyPrompt(shot)}
                        >
                          {copied === shot.shotId ? (
                            <Check size={15} />
                          ) : (
                            <Copy size={15} />
                          )}
                          {copied === shot.shotId
                            ? "Prompt copied"
                            : "Copy video prompt"}
                        </button>
                        <label
                          className="storyboard-file"
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => dropVideo(shot.shotId, event)}
                          onPaste={(event) => pasteVideo(shot.shotId, event)}
                          tabIndex={shot.sourceImageAsset && !busy ? 0 : -1}
                        >
                          <Upload size={15} />
                          <span>
                            {files[shot.shotId]
                              ? `${files[shot.shotId]?.name} · ${formatBytes(files[shot.shotId]?.size ?? 0)}`
                              : "Choose, drop, or paste video"}
                          </span>
                          <input
                            type="file"
                            accept="video/mp4,video/quicktime,video/webm,.mov"
                            disabled={!shot.sourceImageAsset || Boolean(busy)}
                            onChange={(event) =>
                              chooseVideo(shot.shotId, event.target.files?.[0])
                            }
                          />
                        </label>
                        <button
                          className="button secondary"
                          disabled={
                            !files[shot.shotId] ||
                            !shot.sourceImageAsset ||
                            Boolean(busy)
                          }
                          onClick={() => void importVideo(shot.shotId)}
                        >
                          {busy === `import-${shot.shotId}` ? (
                            <LoaderCircle className="spinner" size={15} />
                          ) : (
                            <Play size={15} />
                          )}
                          Import video
                        </button>
                      </div>
                    ) : provider && model ? (
                      <CloudVideoControls
                        audio={
                          model.supportsNativeAudio &&
                          Boolean(audio[shot.shotId])
                        }
                        busy={Boolean(busy)}
                        model={model}
                        provider={provider}
                        resolution={selectedResolution(shot.shotId, model)}
                        shot={shot}
                        onAudio={(value) =>
                          setAudio((current) => ({
                            ...current,
                            [shot.shotId]: value,
                          }))
                        }
                        onGenerate={() => void generateCloud(shot, provider.id)}
                        onModel={(value) => {
                          setModels((current) => ({
                            ...current,
                            [shot.shotId]: value,
                          }));
                          const nextModel = provider.models.find(
                            (candidate) => candidate.id === value,
                          );
                          if (!nextModel?.supportsNativeAudio) {
                            setAudio((current) => ({
                              ...current,
                              [shot.shotId]: false,
                            }));
                          }
                        }}
                        onResolution={(value) =>
                          setResolutions((current) => ({
                            ...current,
                            [shot.shotId]: value,
                          }))
                        }
                      />
                    ) : null}

                    <details className="video-prompt-details">
                      <summary>View exact video prompt</summary>
                      <pre>{shot.prompt}</pre>
                    </details>
                  </div>
                </div>

                {shot.attempts.length === 0 ? (
                  <div className="attempts-empty">
                    No video attempts yet. The approved still above is the
                    recommended source photo for this shot.
                  </div>
                ) : (
                  <div className="video-attempt-grid">
                    {shot.attempts.map((attempt) => (
                      <article
                        className={`video-attempt ${attempt.selected ? "selected" : ""}`}
                        key={attempt.id}
                      >
                        <div className="video-attempt-preview">
                          {attempt.asset ? (
                            <video
                              controls
                              preload="metadata"
                              src={`${apiBaseUrl}/projects/${id}/video-assets/${attempt.asset.id}/content`}
                            />
                          ) : (
                            <span>
                              {attempt.status === "failed" ? (
                                <AlertTriangle size={25} />
                              ) : (
                                <LoaderCircle className="spinner" size={25} />
                              )}
                              {attempt.status.replaceAll("-", " ")}
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
                                : modelLabel(attempt.model, attempt.provider)}
                            </strong>
                            <small>
                              {new Date(attempt.createdAt).toLocaleString()}
                            </small>
                          </div>
                          <div className="attempt-facts">
                            <span>
                              Length <b>{attempt.requestedDurationSeconds}s</b>
                            </span>
                            <span>
                              Output <b>{attempt.resolution}</b>
                            </span>
                            <span>
                              Cost{" "}
                              <b>
                                {attempt.costMicros > 0
                                  ? `${attempt.costIsEstimate ? "≈" : ""}${formatUsd(attempt.costMicros / 1_000_000)}`
                                  : attempt.provider === "manual"
                                    ? "$0.00"
                                    : "See provider"}
                              </b>
                            </span>
                          </div>
                          {attempt.errorMessage && (
                            <p className="attempt-error">
                              {attempt.errorMessage}
                            </p>
                          )}
                          {["submitted", "processing", "downloading"].includes(
                            attempt.status,
                          ) && (
                            <button
                              className="button secondary refresh-video"
                              disabled={Boolean(busy)}
                              onClick={() => void refreshAttempt(attempt)}
                            >
                              <RefreshCw
                                className={
                                  busy === `refresh-${attempt.id}`
                                    ? "spinner"
                                    : ""
                                }
                                size={14}
                              />
                              Refresh now
                            </button>
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
                                <Check size={14} />
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
                                <X size={14} />
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
              </section>
            );
          })}
        </div>
      )}
      {lightbox.element}
    </div>
  );
}

function ProviderBanner({ provider }: { provider: VideoProviderStatus }) {
  return (
    <section
      className={`provider-banner ${provider.configured ? "online" : ""}`}
    >
      <span className="provider-icon">
        <Cloud size={20} />
      </span>
      <div>
        <strong>{provider.label}</strong>
        <p>
          {provider.models.map((model) => model.label).join(" or ")} available
          per shot.
        </p>
        <small>Default: {modelLabel(provider.defaultModel, provider.id)}</small>
      </div>
      <span className="provider-state">
        {provider.configured ? <CheckCircle2 size={14} /> : <X size={14} />}
        {provider.configured ? "Connected" : "Key missing"}
      </span>
    </section>
  );
}

function CloudVideoControls({
  shot,
  provider,
  model,
  resolution,
  audio,
  busy,
  onResolution,
  onModel,
  onAudio,
  onGenerate,
}: {
  shot: VideoShotPlan;
  provider: VideoProviderStatus;
  model: VideoProviderModel;
  resolution: VideoResolution;
  audio: boolean;
  busy: boolean;
  onResolution: (value: VideoResolution) => void;
  onModel: (value: string) => void;
  onAudio: (value: boolean) => void;
  onGenerate: () => void;
}) {
  const duration = providerDuration(shot.durationSeconds, model);
  const rate = audio
    ? model.estimatedUsdPerSecond.withAudio[resolution]
    : model.estimatedUsdPerSecond.withoutAudio[resolution];
  const estimatedCost =
    duration === null || rate === null
      ? "Check provider console"
      : `About ${formatUsd(rate * duration)}`;
  return (
    <div className="cloud-video-controls">
      <div className="cloud-settings-row">
        <label className="field">
          <span>Model</span>
          <select
            value={model.id}
            onChange={(event) => onModel(event.target.value)}
          >
            {provider.models.map((value) => (
              <option value={value.id} key={value.id}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Resolution</span>
          <select
            value={resolution}
            onChange={(event) =>
              onResolution(event.target.value as VideoResolution)
            }
          >
            {model.supportedResolutions.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="cloud-audio-toggle">
          <input
            type="checkbox"
            checked={audio}
            disabled={!model.supportsNativeAudio}
            onChange={(event) => onAudio(event.target.checked)}
          />
          {model.supportsNativeAudio ? "Native audio" : "No native audio"}
        </label>
        <span className="cloud-estimate">
          <small>Provider duration</small>
          <strong>{duration === null ? "Too long" : `${duration}s`}</strong>
        </span>
        <span className="cloud-estimate">
          <small>Charge estimate</small>
          <strong>{estimatedCost}</strong>
        </span>
      </div>
      <p className="cloud-continuity-note">
        <ImageIcon size={14} /> {model.continuityMessage}
      </p>
      {model.warning && (
        <p className="cloud-provider-warning">
          <AlertTriangle size={14} /> {model.warning}
        </p>
      )}
      {duration === null && (
        <p className="cloud-provider-warning">
          <AlertTriangle size={14} /> Split this {shot.durationSeconds}s shot;
          {model.label} accepts at most{" "}
          {Math.max(...model.supportedDurationsSeconds)}s.
        </p>
      )}
      <button
        className="button primary"
        disabled={
          !shot.sourceImageAsset ||
          !provider.configured ||
          duration === null ||
          busy
        }
        onClick={onGenerate}
      >
        <Cloud size={15} /> Review cost &amp; generate
      </button>
      {!provider.configured && (
        <small className="provider-setup-hint">
          Add the API key to <code>.env.local</code>, then restart the API.
        </small>
      )}
    </div>
  );
}

function providerDuration(
  shotDurationSeconds: number,
  model: VideoProviderModel,
): number | null {
  const target = Math.ceil(shotDurationSeconds);
  return (
    [...model.supportedDurationsSeconds]
      .sort((left, right) => left - right)
      .find((duration) => duration >= target) ?? null
  );
}

function modelLabel(model: string | null, provider: string): string {
  if (model === "kling-2.5-turbo") return "Kling 2.5 Turbo";
  if (model === "kling-3.0") return "Kling 3.0";
  if (provider === "seedance") return "Seedance 2.0";
  return model ?? provider;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
