"use client";

import type { Project } from "@ai-studio/contracts";
import { Film, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ProjectCard } from "@/components/project-card";
import { apiFetch } from "@/lib/api";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Project["type"]>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiFetch<{ items: Project[] }>("/projects")
      .then((result) => setProjects(result.items))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      projects.filter((project) => {
        const matchesType = filter === "all" || project.type === filter;
        const term = query.toLowerCase();
        return (
          matchesType &&
          (project.title.toLowerCase().includes(term) ||
            project.topic.toLowerCase().includes(term))
        );
      }),
    [projects, query, filter],
  );

  return (
    <div className="page">
      <header className="page-heading compact">
        <div>
          <span className="eyebrow">
            <Film size={14} /> Production library
          </span>
          <h1>Projects</h1>
          <p>Every Reel, film, and unfinished idea in one place.</p>
        </div>
        <Link className="button primary" href="/projects/new">
          <Plus size={17} /> New project
        </Link>
      </header>
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title or topic…"
            aria-label="Search projects"
          />
        </label>
        <div className="segmented" aria-label="Filter projects">
          {(["all", "reel", "video"] as const).map((value) => (
            <button
              className={filter === value ? "selected" : ""}
              onClick={() => setFilter(value)}
              key={value}
            >
              {value === "all" ? "All" : value === "reel" ? "Reels" : "Videos"}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="project-grid">
          <div className="project-skeleton" />
          <div className="project-skeleton" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <div className="empty-state small">
          <h2>No matching projects</h2>
          <p>Try a broader search or another format.</p>
        </div>
      ) : (
        <div className="project-grid">
          {filtered.map((project) => (
            <ProjectCard project={project} key={project.id} />
          ))}
        </div>
      )}
    </div>
  );
}
