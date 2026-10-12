"use client";

import {
  paidAudioConfirmation,
  type AudioAttempt,
  type AudioWorkspace,
  type Project,
  type Voice,
  type VoiceProfile,
} from "@ai-film-studio/contracts";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  LoaderCircle,
  MessageSquareText,
  Mic,
  Music,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { apiBaseUrl, apiFetch } from "@/lib/api";

type GenerationRequest = {
  key: string;
  path: string;
  label: string;
  estimateUsd: number;
};

export default function SoundPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project>();
  const [workspace, setWorkspace] = useState<AudioWorkspace>();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceError, setVoiceError] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [nextProject, nextWorkspace] = await Promise.all([
      apiFetch<Project>(`/projects/${id}`),
      apiFetch<AudioWorkspace>(`/projects/${id}/sound-workspace`),
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
              : "Could not open the sound workspace.",
          );
        }
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [load]);

  const configured = workspace?.provider.configured ?? false;
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void apiFetch<{ voices: Voice[] }>("/providers/audio/voices")
      .then((response) => {
        if (!cancelled) setVoices(response.voices);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setVoiceError(
            reason instanceof Error
              ? reason.message
              : "ElevenLabs voices could not be loaded.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [configured]);

  const generating = workspace
    ? allAttempts(workspace).some((attempt) => attempt.status === "generating")
    : false;
  useEffect(() => {
    if (!generating) return;
    const interval = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [generating, load]);

  async function saveVoice(
    role: VoiceProfile["role"],
    characterId: string | null,
    voiceId: string,
  ) {
    const voice = voices.find((candidate) => candidate.voiceId === voiceId);
    if (!voice) return;
    setBusy(`voice-${characterId ?? "narrator"}`);
    setError("");
    try {
      await apiFetch(`/projects/${id}/voice-profiles`, {
        method: "PUT",
        body: JSON.stringify({
          role,
          characterId,
          voiceId: voice.voiceId,
          voiceName: voice.name,
        }),
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The voice was not saved.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function generate(request: GenerationRequest) {
    const accepted = window.confirm(
      [
        "ElevenLabs is a paid generation.",
        "",
        `For: ${request.label}`,
        `Estimate: about ${formatUsd(request.estimateUsd)}`,
        "",
        "The recorded cost appears on the take. Continue?",
      ].join("\n"),
    );
    if (!accepted) return;
    setBusy(request.key);
    setError("");
    try {
      await apiFetch(`/projects/${id}/${request.path}`, {
        method: "POST",
        body: JSON.stringify({ confirmation: paidAudioConfirmation }),
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The audio could not be generated.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function review(attemptId: string, decision: "approve" | "reject") {
    setBusy(`${decision}-${attemptId}`);
    setError("");
    try {
      await apiFetch(`/projects/${id}/audio-attempts/${attemptId}/review`, {
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
    return (
      <div className="page">
        {error ? (
          <div className="notice error">
            <strong>Sound unavailable</strong>
            <span>{error}</span>
          </div>
        ) : (
          <div className="project-detail-skeleton" />
        )}
      </div>
    );
  }

  const rates = workspace.provider.estimatedUsd;
  const speechCost = (text: string) =>
    (text.length / 1000) * rates.speechPer1kCharacters;
  const canGenerate = configured && !busy;
  const attemptProps = {
    projectId: project.id,
    busy: Boolean(busy),
    onReview: (attemptId: string, decision: "approve" | "reject") =>
      void review(attemptId, decision),
  };

  return (
    <div className="page sound-page">
      <Link className="back-link" href={`/projects/${project.id}`}>
        <ArrowLeft size={16} /> {project.title}
      </Link>
      <header className="storyboard-heading">
        <div>
          <span className="eyebrow">
            <Volume2 size={14} /> Sound production
          </span>
          <h1>Sound</h1>
          <p>
            Give the narrator and each character a voice, then generate
            narration, dialogue, sound effects, and music. Approve one take for
            each.
          </p>
        </div>
        <div className="storyboard-metrics">
          <span>
            <strong>{workspace.totals.approved}</strong> approved
          </span>
          <span>
            <strong>{workspace.totals.attempts}</strong> takes
          </span>
          <span>
            <strong>
              {formatUsd(workspace.totals.costMicros / 1_000_000)}
            </strong>{" "}
            spent
          </span>
        </div>
      </header>

      <section className={`provider-banner ${configured ? "online" : ""}`}>
        <span className="provider-icon">
          <Mic size={20} />
        </span>
        <div>
          <strong>{workspace.provider.label}</strong>
          <p>{workspace.provider.message}</p>
          <small>
            Voice {workspace.provider.speechModel} · about{" "}
            {formatUsd(rates.speechPer1kCharacters)} per 1,000 characters ·
            effects {formatUsd(rates.soundEffectPerMinute)}/min · music{" "}
            {formatUsd(rates.musicPerMinute)}/min
            {workspace.languageCode
              ? ` · language ${workspace.languageCode.toUpperCase()}`
              : ""}
          </small>
        </div>
        <span className="provider-state">
          {configured ? <CheckCircle2 size={14} /> : <X size={14} />}
          {configured ? "Connected" : "Key missing"}
        </span>
      </section>

      {error && (
        <div className="notice error storyboard-notice" role="alert">
          <AlertTriangle size={16} /> <span>{error}</span>
        </div>
      )}

      <section className="sound-panel">
        <h2>
          <Mic size={16} /> Voices
        </h2>
        {voiceError && (
          <p className="image-generator-note warn">{voiceError}</p>
        )}
        <div className="voice-list">
          <VoiceRow
            label="Narrator"
            hint="Reads every scene's narration."
            profile={workspace.narrator}
            voices={voices}
            disabled={!configured || Boolean(busy)}
            onChange={(voiceId) => void saveVoice("narrator", null, voiceId)}
          />
          {workspace.characters.map((character) => (
            <VoiceRow
              key={character.characterId}
              label={character.name}
              hint={character.voiceDescription || character.code}
              profile={character.profile}
              voices={voices}
              disabled={!configured || Boolean(busy)}
              onChange={(voiceId) =>
                void saveVoice("character", character.characterId, voiceId)
              }
            />
          ))}
        </div>
      </section>

      <section className="sound-panel">
        <h2>
          <Music size={16} /> Background music
        </h2>
        <p className="sound-prompt">{workspace.music.prompt}</p>
        <div className="sound-actions">
          <button
            className="button primary"
            disabled={!canGenerate}
            onClick={() =>
              void generate({
                key: "music",
                path: "music-generations",
                label: `Background music, ${workspace.music.durationSeconds}s`,
                estimateUsd:
                  (workspace.music.durationSeconds / 60) * rates.musicPerMinute,
              })
            }
          >
            <Busy active={busy === "music"} icon={<Sparkles size={15} />} />
            Generate music ({workspace.music.durationSeconds}s)
          </button>
        </div>
        <AudioAttempts attempts={workspace.music.attempts} {...attemptProps} />
      </section>

      {workspace.scenes.length === 0 ? (
        <div className="storyboard-empty">
          <Volume2 size={26} />
          <h2>No scenes yet</h2>
          <p>Import a story plan before producing sound.</p>
          <Link className="button primary" href={`/projects/${id}/story`}>
            Open story plan
          </Link>
        </div>
      ) : (
        workspace.scenes.map((scene) => (
          <section className="storyboard-shot sound-scene" key={scene.sceneId}>
            <header>
              <div className="shot-identity">
                <span>SCENE {scene.sceneNumber}</span>
                <div>
                  <h2>{scene.location}</h2>
                  <p>{scene.shots.length} shots</p>
                </div>
              </div>
            </header>

            <div className="sound-block">
              <h3>
                <Mic size={14} /> Narration
              </h3>
              {scene.narration.text ? (
                <>
                  <p className="sound-script">{scene.narration.text}</p>
                  <button
                    className="button secondary"
                    disabled={!canGenerate || !workspace.narrator}
                    title={
                      workspace.narrator ? undefined : "Choose a narrator voice"
                    }
                    onClick={() =>
                      void generate({
                        key: `narration-${scene.sceneId}`,
                        path: `scenes/${scene.sceneId}/narration-generations`,
                        label: `Scene ${scene.sceneNumber} narration`,
                        estimateUsd: speechCost(scene.narration.text!),
                      })
                    }
                  >
                    <Busy
                      active={busy === `narration-${scene.sceneId}`}
                      icon={<Sparkles size={15} />}
                    />
                    Generate narration
                  </button>
                  <AudioAttempts
                    attempts={scene.narration.attempts}
                    {...attemptProps}
                  />
                </>
              ) : (
                <p className="sound-empty">No narration in this scene.</p>
              )}
            </div>

            <div className="sound-block">
              <h3>
                <MessageSquareText size={14} /> Dialogue
              </h3>
              {scene.dialogue.lines.length > 0 ? (
                <>
                  <ul className="dialogue-lines">
                    {scene.dialogue.lines.map((line, index) => (
                      <li key={`${index}-${line.speaker}`}>
                        <strong>{line.speaker}</strong> {line.text}
                      </li>
                    ))}
                  </ul>
                  {scene.dialogue.missingVoices.length > 0 && (
                    <p className="image-generator-note warn">
                      Choose a voice for{" "}
                      {scene.dialogue.missingVoices.join(", ")}.
                    </p>
                  )}
                  <button
                    className="button secondary"
                    disabled={
                      !canGenerate || scene.dialogue.missingVoices.length > 0
                    }
                    onClick={() =>
                      void generate({
                        key: `dialogue-${scene.sceneId}`,
                        path: `scenes/${scene.sceneId}/dialogue-generations`,
                        label: `Scene ${scene.sceneNumber} dialogue`,
                        estimateUsd: speechCost(
                          scene.dialogue.lines
                            .map((line) => line.text)
                            .join(""),
                        ),
                      })
                    }
                  >
                    <Busy
                      active={busy === `dialogue-${scene.sceneId}`}
                      icon={<Sparkles size={15} />}
                    />
                    Generate dialogue
                  </button>
                  <AudioAttempts
                    attempts={scene.dialogue.attempts}
                    {...attemptProps}
                  />
                </>
              ) : (
                <p className="sound-empty">No dialogue in this scene.</p>
              )}
            </div>

            <div className="sound-block">
              <h3>
                <Volume2 size={14} /> Sound effects
              </h3>
              <div className="sound-shot-list">
                {scene.shots.map((shot) => (
                  <div className="sound-shot" key={shot.shotId}>
                    <div className="sound-shot-heading">
                      <span className="entity-code">{shot.shotCode}</span>
                      <p>{shot.action}</p>
                      <button
                        className="button secondary"
                        disabled={!canGenerate}
                        onClick={() =>
                          void generate({
                            key: `sfx-${shot.shotId}`,
                            path: `shots/${shot.shotId}/sound-effect-generations`,
                            label: `${shot.shotCode} sound effects, ${shot.soundEffects.durationSeconds}s`,
                            estimateUsd:
                              (shot.soundEffects.durationSeconds / 60) *
                              rates.soundEffectPerMinute,
                          })
                        }
                      >
                        <Busy
                          active={busy === `sfx-${shot.shotId}`}
                          icon={<Sparkles size={15} />}
                        />
                        Generate effects ({shot.soundEffects.durationSeconds}s)
                      </button>
                    </div>
                    <AudioAttempts
                      attempts={shot.soundEffects.attempts}
                      {...attemptProps}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function VoiceRow({
  label,
  hint,
  profile,
  voices,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  profile: VoiceProfile | null;
  voices: Voice[];
  disabled: boolean;
  onChange: (voiceId: string) => void;
}) {
  const selected = voices.find((voice) => voice.voiceId === profile?.voiceId);
  return (
    <div className="voice-row">
      <div>
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <select
        aria-label={`Voice for ${label}`}
        value={profile?.voiceId ?? ""}
        disabled={disabled || voices.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          {voices.length === 0 ? "No voices loaded" : "Choose a voice"}
        </option>
        {profile && !selected && (
          <option value={profile.voiceId}>{profile.voiceName}</option>
        )}
        {voices.map((voice) => (
          <option value={voice.voiceId} key={voice.voiceId}>
            {voiceLabel(voice)}
          </option>
        ))}
      </select>
      {selected?.previewUrl ? (
        <audio controls preload="none" src={selected.previewUrl} />
      ) : (
        <span className="voice-preview-empty">
          {profile ? profile.voiceName : "No voice yet"}
        </span>
      )}
    </div>
  );
}

function AudioAttempts({
  attempts,
  projectId,
  busy,
  onReview,
}: {
  attempts: AudioAttempt[];
  projectId: string;
  busy: boolean;
  onReview: (attemptId: string, decision: "approve" | "reject") => void;
}) {
  if (attempts.length === 0) return null;
  return (
    <ul className="audio-attempts">
      {attempts.map((attempt) => (
        <li
          key={attempt.id}
          className={`audio-attempt ${attempt.selected ? "selected" : ""}`}
        >
          {attempt.status === "succeeded" && attempt.asset ? (
            <audio
              controls
              preload="metadata"
              src={`${apiBaseUrl}/projects/${projectId}/audio-attempts/${attempt.id}/content`}
            />
          ) : attempt.status === "generating" ? (
            <span className="audio-attempt-state">
              <LoaderCircle className="spinner" size={15} /> Generating…
            </span>
          ) : (
            <span className="audio-attempt-state failed">
              <AlertTriangle size={15} /> {attempt.errorMessage ?? "Failed"}
            </span>
          )}
          <small>
            {new Date(attempt.createdAt).toLocaleString()} ·{" "}
            {formatUsd(attempt.costMicros / 1_000_000)}
            {attempt.selected ? " · approved" : ""}
          </small>
          {attempt.status === "succeeded" && (
            <span className="audio-attempt-review">
              <button
                className="button approve"
                disabled={busy || attempt.selected}
                onClick={() => onReview(attempt.id, "approve")}
              >
                <Check size={14} /> {attempt.selected ? "Approved" : "Approve"}
              </button>
              <button
                className="button reject"
                disabled={busy || attempt.reviewStatus === "rejected"}
                onClick={() => onReview(attempt.id, "reject")}
              >
                <X size={14} />{" "}
                {attempt.reviewStatus === "rejected" ? "Rejected" : "Reject"}
              </button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Busy({ active, icon }: { active: boolean; icon: ReactNode }) {
  return active ? <LoaderCircle className="spinner" size={15} /> : icon;
}

function allAttempts(workspace: AudioWorkspace): AudioAttempt[] {
  return [
    ...workspace.music.attempts,
    ...workspace.scenes.flatMap((scene) => [
      ...scene.narration.attempts,
      ...scene.dialogue.attempts,
      ...scene.shots.flatMap((shot) => shot.soundEffects.attempts),
    ]),
  ];
}

function voiceLabel(voice: Voice): string {
  const details = [voice.labels.gender, voice.labels.age, voice.labels.accent]
    .filter(Boolean)
    .join(", ");
  return details ? `${voice.name} — ${details}` : voice.name;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.1 ? 3 : 2,
  }).format(value);
}
