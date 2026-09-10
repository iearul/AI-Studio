import type { Project } from "@ai-film-studio/contracts";
import { ArrowUpRight, Clock3, Film, Smartphone } from "lucide-react";
import Link from "next/link";

const styles: Record<Project["style"], string> = {
  mystery: "Mystery",
  horror: "Horror",
  historical: "Historical",
  mythological: "Mythological",
  documentary: "Documentary",
  cinematic: "Cinematic",
  custom: "Custom",
};

export function ProjectCard({ project }: { project: Project }) {
  const minutes = Math.floor(project.targetDurationSeconds / 60);
  const seconds = project.targetDurationSeconds % 60;
  const duration = minutes > 0 ? `${minutes}m ${seconds || ""}` : `${seconds}s`;
  const TypeIcon = project.type === "reel" ? Smartphone : Film;
  return (
    <Link className="project-card" href={`/projects/${project.id}`}>
      <div className={`project-art ${project.style}`}>
        <span className="project-type">
          <TypeIcon size={14} /> {project.type}
        </span>
        <span className="project-ratio">{project.aspectRatio}</span>
        <div className="art-orbit orbit-one" />
        <div className="art-orbit orbit-two" />
        <strong>{project.title.slice(0, 1).toUpperCase()}</strong>
      </div>
      <div className="project-card-body">
        <div>
          <span className={`status ${project.status}`}>{project.status}</span>
          <span className="style-label">{styles[project.style]}</span>
        </div>
        <h3>{project.title}</h3>
        <p>{project.topic}</p>
        <footer>
          <span>
            <Clock3 size={14} /> {duration}
          </span>
          <span>
            {new Date(project.updatedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
          <ArrowUpRight size={17} />
        </footer>
      </div>
    </Link>
  );
}
