import { Clapperboard, Plus } from "lucide-react";
import Link from "next/link";

export function EmptyState() {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Clapperboard size={28} />
      </span>
      <h2>Your first production starts here</h2>
      <p>
        Create a compact Reel or plan a longer film. Every creative step stays
        reviewable.
      </p>
      <Link className="button primary" href="/projects/new">
        <Plus size={17} /> New project
      </Link>
    </div>
  );
}
