"use client";

import type { Project } from "@ai-studio/contracts";
import { ArrowRight, Film, Plus, Smartphone, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ProjectCard } from "@/components/project-card";
import { apiFetch } from "@/lib/api";

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void apiFetch<{ items: Project[] }>("/projects")
      .then((response) => setProjects(response.items))
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "Could not load projects.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page dashboard-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">
            <Sparkles size={14} /> Production overview
          </span>
          <h1>Good evening, Director.</h1>
          <p>Shape the next story, one deliberate shot at a time.</p>
        </div>
        <Link className="button primary" href="/projects/new">
          <Plus size={17} /> New project
        </Link>
      </header>

      <section className="format-grid" aria-label="Start a project">
        <Link
          href="/projects/new?type=reel"
          className="format-card reel-format"
        >
          <span className="format-icon">
            <Smartphone size={25} />
          </span>
          <div>
            <small>Fast, vertical stories</small>
            <h2>Reels &amp; Shorts</h2>
            <p>
              Mystery, horror, suspense and high-retention twists in 30–60
              seconds.
            </p>
            <span className="inline-link">
              Start a Reel <ArrowRight size={16} />
            </span>
          </div>
          <div className="format-glow" />
        </Link>
        <Link
          href="/projects/new?type=video"
          className="format-card video-format"
        >
          <span className="format-icon">
            <Film size={25} />
          </span>
          <div>
            <small>Depth, chapters, continuity</small>
            <h2>Films &amp; Videos</h2>
            <p>
              Build cinematic history, mythology and educational stories scene
              by scene.
            </p>
            <span className="inline-link">
              Plan a video <ArrowRight size={16} />
            </span>
          </div>
          <div className="format-glow" />
        </Link>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Recent projects</h2>
            <p>Continue where the creative thread left off.</p>
          </div>
          {projects.length > 0 && (
            <Link href="/projects" className="text-link">
              View all <ArrowRight size={15} />
            </Link>
          )}
        </div>
        {loading ? (
          <div className="project-grid">
            <div className="project-skeleton" />
            <div className="project-skeleton" />
          </div>
        ) : error ? (
          <div className="notice error">
            <strong>Studio API unavailable</strong>
            <span>
              {error} Start it with <code>pnpm dev:api</code>.
            </span>
          </div>
        ) : projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="project-grid">
            {projects.slice(0, 4).map((project) => (
              <ProjectCard project={project} key={project.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
