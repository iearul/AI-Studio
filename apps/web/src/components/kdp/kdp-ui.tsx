"use client";

import type { KdpJob } from "@ai-film-studio/contracts";
import {
  AlertTriangle,
  Check,
  Copy,
  LibraryBig,
  LoaderCircle,
  PenLine,
  Play,
  Settings2,
  Square,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  errorMessage,
  formatUsd,
  isActiveJob,
  jobKindLabels,
  jobStatusLabels,
  kdpPath,
  kdpSend,
} from "@/lib/kdp";

const sections = [
  { href: "/kdp", label: "My books", icon: LibraryBig },
  { href: "/kdp/new", label: "Create new story", icon: PenLine },
  { href: "/kdp/settings", label: "Settings", icon: Settings2 },
];

/** Module-level navigation shown on every KDP Story Studio page. */
export function KdpSectionNav() {
  const pathname = usePathname();
  return (
    <nav className="kdp-section-nav" aria-label="KDP Story Studio">
      <span className="kdp-module-name">KDP Story Studio</span>
      <div>
        {sections.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/kdp"
              ? pathname === "/kdp" || pathname.startsWith("/kdp/books")
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={15} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="kdp-copy"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        });
      }}
      aria-label={`${label}: ${value.slice(0, 40)}`}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label?: string;
}) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className="kdp-progress"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * Live status of a background job with cancel and resume. Long jobs keep
 * running on the server when this page is closed.
 */
export function JobPanel({
  job,
  bookId,
  workerRunning,
  onChange,
}: {
  job: KdpJob;
  bookId: string;
  workerRunning: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const active = isActiveJob(job);
  const act = async (action: "cancel" | "resume") => {
    setBusy(true);
    setError(undefined);
    try {
      await kdpSend(kdpPath(bookId, `/jobs/${job.id}/${action}`), "POST");
      onChange();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const stopped = ["failed", "cancelled", "budget_stopped"].includes(
    job.status,
  );
  return (
    <section className={`kdp-job ${job.status}`} aria-live="polite">
      <div className="kdp-job-head">
        {active ? (
          <LoaderCircle size={17} className="spin" />
        ) : stopped ? (
          <AlertTriangle size={17} />
        ) : (
          <Check size={17} />
        )}
        <div>
          <strong>{jobKindLabels[job.kind]}</strong>
          <small>
            {jobStatusLabels[job.status]}
            {job.progressLabel && active ? ` · ${job.progressLabel}` : ""}
            {job.stepsTotal > 0
              ? ` · ${job.stepsDone}/${job.stepsTotal} steps`
              : ""}
            {` · ${formatUsd(job.actualCostMicros)} spent`}
            {job.estimatedCostMicros > 0
              ? ` of about ${formatUsd(job.estimatedCostMicros)}`
              : ""}
          </small>
        </div>
        <div className="kdp-job-actions">
          {active && (
            <button
              type="button"
              className="button secondary"
              disabled={busy || job.cancelRequested}
              onClick={() => void act("cancel")}
            >
              <Square size={14} /> {job.cancelRequested ? "Stopping…" : "Stop"}
            </button>
          )}
          {stopped && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void act("resume")}
            >
              <Play size={14} /> Resume
            </button>
          )}
        </div>
      </div>
      {active && (
        <ProgressBar value={job.progress} label={jobKindLabels[job.kind]} />
      )}
      {active && !workerRunning && (
        <p className="kdp-job-note">
          The background worker is not running in this API process, so the job
          waits until the app is started normally.
        </p>
      )}
      {active && workerRunning && (
        <p className="kdp-job-note">
          Runs on the server: you can close this page and come back later.
        </p>
      )}
      {job.errorMessage && stopped && (
        <p className="kdp-job-error">{job.errorMessage}</p>
      )}
      {stopped && (
        <p className="kdp-job-note">
          Finished steps are saved. Resume continues where it stopped.
        </p>
      )}
      {error && <p className="kdp-job-error">{error}</p>}
    </section>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
  children: ReactNode;
}) {
  return <span className={`kdp-pill ${tone}`}>{children}</span>;
}

export function EmptyPanel({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="kdp-empty">
      <span className="kdp-empty-icon">{icon}</span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
