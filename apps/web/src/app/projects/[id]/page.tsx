"use client";

import type { Project } from "@ai-film-studio/contracts";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  Film,
  MapPin,
  PencilLine,
  Smartphone,
  Sparkles,
  Users,
  WandSparkles,
  Images,
  Video,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

const workflow = [
  {
    title: "Story",
    description: "Develop the premise, hook and narrative shape.",
    icon: BookOpen,
    path: "story",
  },
  {
    title: "Characters",
    description: "Define appearance, personality and references.",
    icon: Users,
    path: "bible?tab=characters",
  },
  {
    title: "Locations",
    description: "Build consistent spaces and visual anchors.",
    icon: MapPin,
    path: "bible?tab=locations",
  },
  {
    title: "Shot plan",
    description: "Turn scenes into deliberate camera decisions.",
    icon: Film,
    path: "story",
  },
  {
    title: "Storyboard",
    description: "Generate or import frames and approve one image per shot.",
    icon: Images,
    path: "storyboard",
  },
  {
    title: "Video",
    description: "Animate an approved frame with Veo, Kling, or Seedance.",
    icon: Video,
    path: "video",
  },
  {
    title: "Sound",
    description: "Voices, narration, dialogue, sound effects, and music.",
    icon: Volume2,
    path: "sound",
  },
];

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void apiFetch<Project>(`/projects/${id}`)
      .then(setProject)
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "Could not load project.",
        ),
      );
  }, [id]);

  if (error)
    return (
      <div className="page">
        <div className="notice error">
          <strong>Project unavailable</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  if (!project)
    return (
      <div className="page">
        <div className="project-detail-skeleton" />
      </div>
    );
  const TypeIcon = project.type === "reel" ? Smartphone : Film;
  return (
    <div className="page project-detail">
      <Link className="back-link" href="/projects">
        <ArrowLeft size={16} /> All projects
      </Link>
      <header className={`project-hero ${project.style}`}>
        <div className="hero-kicker">
          <span>
            <TypeIcon size={15} /> {project.type}
          </span>
          <span>{project.aspectRatio}</span>
          <span>{project.style}</span>
        </div>
        <h1>{project.title}</h1>
        <p>{project.topic}</p>
        <div className="hero-meta">
          <span>
            <Clock3 size={16} />{" "}
            {project.targetDurationSeconds < 120
              ? `${project.targetDurationSeconds} seconds`
              : `${Math.round(project.targetDurationSeconds / 60)} minutes`}
          </span>
          <span>{project.language.toUpperCase()}</span>
          <span>{project.narration}</span>
        </div>
        <button
          className="button glass"
          disabled
          title="Editing arrives with the story workspace"
        >
          <PencilLine size={16} /> Edit brief
        </button>
        <div className="hero-noise" />
      </header>

      <div className="detail-grid">
        <section className="workflow-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                <WandSparkles size={14} /> Human-in-the-loop
              </span>
              <h2>Production workflow</h2>
              <p>Review and approve each layer before generation.</p>
            </div>
          </div>
          <div className="workflow-list">
            {workflow.map(({ title, description, icon: Icon, path }, index) => {
              const content = (
                <>
                  <span className="workflow-icon">
                    <Icon size={19} />
                  </span>
                  <div>
                    <small>Step {index + 1}</small>
                    <strong>{title}</strong>
                    <p>{description}</p>
                  </div>
                  <span className="coming-soon ready">Open</span>
                  <ArrowRight size={17} />
                </>
              );
              return (
                <Link
                  className="workflow-row enabled"
                  href={`/projects/${project.id}/${path}`}
                  key={title}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        </section>
        <aside className="brief-panel">
          <span className="eyebrow">
            <Sparkles size={14} /> Creative brief
          </span>
          <dl>
            <div>
              <dt>Visual style</dt>
              <dd>{project.visualStyle || "Not set"}</dd>
            </div>
            <div>
              <dt>Tone</dt>
              <dd>{project.tone || "Not set"}</dd>
            </div>
            <div>
              <dt>Audience</dt>
              <dd>{project.targetAudience || "Not set"}</dd>
            </div>
            <div>
              <dt>Culture / setting</dt>
              <dd>{project.countryCulture || "Not set"}</dd>
            </div>
            <div>
              <dt>Ending</dt>
              <dd>{project.desiredEnding || "Not set"}</dd>
            </div>
          </dl>
          <div className="manifest-ok">
            <CheckCircle2 size={18} />
            <div>
              <strong>Portable manifest synced</strong>
              <small>Project data is ready for recovery.</small>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
