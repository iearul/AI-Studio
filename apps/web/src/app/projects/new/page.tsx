"use client";

import type { CreateProjectInput, Project } from "@ai-studio/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  Smartphone,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { ApiError, apiFetch } from "@/lib/api";

type FormState = Omit<CreateProjectInput, "targetDurationSeconds"> & {
  targetDurationSeconds: string;
};

const defaultForm = (type: Project["type"]): FormState => ({
  title: "",
  type,
  topic: "",
  language: "en",
  customLanguage: null,
  targetDurationSeconds: type === "reel" ? "60" : "300",
  aspectRatio: type === "reel" ? "9:16" : "16:9",
  style: type === "reel" ? "mystery" : "documentary",
  customStyle: null,
  narration: "narrator",
  targetAudience: null,
  tone: null,
  ageRating: null,
  countryCulture: null,
  visualStyle: null,
  desiredEnding: null,
});

function NewProjectForm() {
  const router = useRouter();
  const search = useSearchParams();
  const initialType = search.get("type") === "video" ? "video" : "reel";
  const [form, setForm] = useState<FormState>(() => defaultForm(initialType));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeType(type: Project["type"]) {
    setForm((current) => ({
      ...current,
      type,
      targetDurationSeconds: type === "reel" ? "60" : "300",
      aspectRatio: type === "reel" ? "9:16" : "16:9",
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const project = await apiFetch<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          targetDurationSeconds: Number(form.targetDurationSeconds),
          customLanguage: form.customLanguage || null,
          customStyle: form.customStyle || null,
        }),
      });
      router.push(`/projects/${project.id}`);
    } catch (reason) {
      if (reason instanceof ApiError && reason.problem?.errors) {
        setError(Object.values(reason.problem.errors).flat().join(" "));
      } else {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not create the project.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page form-page">
      <Link href="/" className="back-link">
        <ArrowLeft size={16} /> Back to studio
      </Link>
      <header className="form-heading">
        <span className="eyebrow">
          <Sparkles size={14} /> New production
        </span>
        <h1>Set the creative brief.</h1>
        <p>
          Start with enough direction to guide the story without locking down
          the discoveries.
        </p>
      </header>
      <form className="project-form" onSubmit={submit}>
        <section className="form-section">
          <div className="form-section-number">01</div>
          <div className="form-section-content">
            <div className="form-section-heading">
              <h2>Choose the format</h2>
              <p>The workflow adapts its pacing, aspect ratio and structure.</p>
            </div>
            <div className="type-picker">
              <button
                type="button"
                className={
                  form.type === "reel" ? "type-option selected" : "type-option"
                }
                onClick={() => changeType("reel")}
              >
                <span>
                  <Smartphone size={23} />
                </span>
                <div>
                  <strong>Reel / Short</strong>
                  <small>Fast hook · 30–60 seconds</small>
                </div>
                {form.type === "reel" && <Check size={18} />}
              </button>
              <button
                type="button"
                className={
                  form.type === "video" ? "type-option selected" : "type-option"
                }
                onClick={() => changeType("video")}
              >
                <span>
                  <Film size={23} />
                </span>
                <div>
                  <strong>Video / Film</strong>
                  <small>Chapters · 3–25 minutes</small>
                </div>
                {form.type === "video" && <Check size={18} />}
              </button>
            </div>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section-number">02</div>
          <div className="form-section-content">
            <div className="form-section-heading">
              <h2>Tell us the idea</h2>
              <p>A working title and clear topic are enough to begin.</p>
            </div>
            <div className="field-grid">
              <label className="field full">
                <span>Project title</span>
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={form.title}
                  onChange={(event) => set("title", event.target.value)}
                  placeholder="The Last Train"
                />
                <small>Use a working title—you can change it later.</small>
              </label>
              <label className="field full">
                <span>Topic or premise</span>
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  rows={4}
                  value={form.topic}
                  onChange={(event) => set("topic", event.target.value)}
                  placeholder="A station keeper sees a light inside a train that disappeared twenty years ago…"
                />
                <small>{form.topic.length}/500</small>
              </label>
            </div>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section-number">03</div>
          <div className="form-section-content">
            <div className="form-section-heading">
              <h2>Shape the production</h2>
              <p>
                These defaults inform future story, shot and prompt engines.
              </p>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>Language</span>
                <select
                  value={form.language}
                  onChange={(event) =>
                    set("language", event.target.value as FormState["language"])
                  }
                >
                  <option value="en">English</option>
                  <option value="bn">Bangla</option>
                  <option value="de">German</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {form.language === "other" && (
                <label className="field">
                  <span>Custom language</span>
                  <input
                    required
                    value={form.customLanguage ?? ""}
                    onChange={(event) =>
                      set("customLanguage", event.target.value)
                    }
                  />
                </label>
              )}
              <label className="field">
                <span>Target duration</span>
                <div className="input-suffix">
                  <input
                    type="number"
                    required
                    min={15}
                    max={form.type === "reel" ? 90 : 1500}
                    value={form.targetDurationSeconds}
                    onChange={(event) =>
                      set("targetDurationSeconds", event.target.value)
                    }
                  />
                  <em>seconds</em>
                </div>
              </label>
              <label className="field">
                <span>Aspect ratio</span>
                <select
                  value={form.aspectRatio}
                  onChange={(event) =>
                    set(
                      "aspectRatio",
                      event.target.value as FormState["aspectRatio"],
                    )
                  }
                >
                  <option value="9:16">9:16 · Vertical</option>
                  <option value="16:9">16:9 · Widescreen</option>
                  <option value="1:1">1:1 · Square</option>
                </select>
              </label>
              <label className="field">
                <span>Story style</span>
                <select
                  value={form.style}
                  onChange={(event) =>
                    set("style", event.target.value as FormState["style"])
                  }
                >
                  <option value="mystery">Mystery</option>
                  <option value="horror">Horror</option>
                  <option value="historical">Historical</option>
                  <option value="mythological">Mythological</option>
                  <option value="documentary">Documentary</option>
                  <option value="cinematic">Cinematic</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {form.style === "custom" && (
                <label className="field">
                  <span>Custom style</span>
                  <input
                    required
                    value={form.customStyle ?? ""}
                    onChange={(event) => set("customStyle", event.target.value)}
                  />
                </label>
              )}
              <label className="field">
                <span>Narration</span>
                <select
                  value={form.narration}
                  onChange={(event) =>
                    set(
                      "narration",
                      event.target.value as FormState["narration"],
                    )
                  }
                >
                  <option value="narrator">Narrator</option>
                  <option value="dialogue">Character dialogue</option>
                  <option value="both">Narrator + dialogue</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="form-section optional-section">
          <div className="form-section-number">04</div>
          <div className="form-section-content">
            <div className="form-section-heading">
              <h2>
                Creative direction <span>Optional</span>
              </h2>
              <p>
                Add guardrails that matter for this audience and visual world.
              </p>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>Target audience</span>
                <input
                  value={form.targetAudience ?? ""}
                  onChange={(event) =>
                    set("targetAudience", event.target.value)
                  }
                  placeholder="Curious adults, 18–35"
                />
              </label>
              <label className="field">
                <span>Tone</span>
                <input
                  value={form.tone ?? ""}
                  onChange={(event) => set("tone", event.target.value)}
                  placeholder="Quiet, ominous, restrained"
                />
              </label>
              <label className="field">
                <span>Age rating</span>
                <input
                  value={form.ageRating ?? ""}
                  onChange={(event) => set("ageRating", event.target.value)}
                  placeholder="13+"
                />
              </label>
              <label className="field">
                <span>Country / culture</span>
                <input
                  value={form.countryCulture ?? ""}
                  onChange={(event) =>
                    set("countryCulture", event.target.value)
                  }
                  placeholder="Rural Bangladesh"
                />
              </label>
              <label className="field">
                <span>Visual style</span>
                <input
                  value={form.visualStyle ?? ""}
                  onChange={(event) => set("visualStyle", event.target.value)}
                  placeholder="Naturalistic 35mm night photography"
                />
              </label>
              <label className="field">
                <span>Desired ending</span>
                <input
                  value={form.desiredEnding ?? ""}
                  onChange={(event) => set("desiredEnding", event.target.value)}
                  placeholder="A final clue, then cut to black"
                />
              </label>
            </div>
          </div>
        </section>
        {error && (
          <div className="notice error" role="alert">
            <strong>Couldn’t create the project</strong>
            <span>{error}</span>
          </div>
        )}
        <div className="form-actions">
          <Link href="/" className="button secondary">
            Cancel
          </Link>
          <button
            className="button primary large"
            disabled={submitting}
            type="submit"
          >
            {submitting ? "Creating…" : "Create project"}
            <ArrowRight size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <div className="project-skeleton" />
        </div>
      }
    >
      <NewProjectForm />
    </Suspense>
  );
}
