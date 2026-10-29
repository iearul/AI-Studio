"use client";

import type {
  EditorialIssue,
  EditorialKind,
  IssueSeverity,
} from "@ai-studio/contracts";
import { Check, CheckCheck, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Pill } from "@/components/kdp/kdp-ui";
import { errorMessage, kdpPath, kdpSend } from "@/lib/kdp";

import { WordDiff } from "./word-diff";

export const editorialKindLabels: Record<EditorialKind, string> = {
  developmental: "Developmental",
  continuity: "Continuity",
  line: "Line edit",
  copy: "Copy edit",
  originality: "Originality and rights",
  style: "Style check",
  inspection: "Chapter inspection",
};

export const severityLabels: Record<IssueSeverity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  suggestion: "Suggestion",
};

export const severityOrder: IssueSeverity[] = [
  "critical",
  "major",
  "minor",
  "suggestion",
];

export const issueStatusLabels: Record<EditorialIssue["status"], string> = {
  open: "Open",
  accepted: "Accepted",
  rejected: "Rejected",
  resolved: "Resolved",
};

const severityTone = {
  critical: "bad",
  major: "warn",
  minor: "neutral",
  suggestion: "neutral",
} as const;

const statusTone = {
  open: "accent",
  accepted: "good",
  rejected: "neutral",
  resolved: "good",
} as const;

type Action = { status: EditorialIssue["status"]; apply: boolean };

export function IssueCard({
  issue,
  bookId,
  onUpdated,
}: {
  issue: EditorialIssue;
  bookId: string;
  onUpdated: (issue: EditorialIssue, applied: boolean) => void;
}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const canApply =
    issue.chapterId !== null &&
    !!issue.originalText &&
    issue.replacementText !== null;

  const act = async (key: string, action: Action) => {
    setBusy(key);
    setError(undefined);
    try {
      const updated = await kdpSend<EditorialIssue>(
        kdpPath(bookId, `/editorial/issues/${issue.id}`),
        "PATCH",
        action,
      );
      onUpdated(updated, action.apply);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const spinner = (key: string, icon: ReactNode) =>
    busy === key ? <LoaderCircle size={14} className="spin" /> : icon;

  return (
    <article className={`kdp-ed-issue ${issue.severity} ${issue.status}`}>
      <header>
        <div className="kdp-ed-issue-tags">
          <Pill tone={severityTone[issue.severity]}>
            {severityLabels[issue.severity]}
          </Pill>
          <Pill>{editorialKindLabels[issue.kind]}</Pill>
          <span className="kdp-muted">
            {issue.chapterNumber
              ? `Chapter ${issue.chapterNumber}`
              : "Whole book"}
            {issue.location &&
            issue.location !== `Chapter ${issue.chapterNumber}`
              ? ` · ${issue.location}`
              : ""}
          </span>
        </div>
        {issue.status !== "open" && (
          <Pill tone={statusTone[issue.status]}>
            {issueStatusLabels[issue.status]}
          </Pill>
        )}
      </header>
      <h3>{issue.issue}</h3>
      {issue.evidence && (
        <blockquote className="kdp-ed-evidence">{issue.evidence}</blockquote>
      )}
      {issue.suggestion && (
        <p className="kdp-ed-suggestion">
          <strong>Suggestion:</strong> {issue.suggestion}
        </p>
      )}
      {issue.originalText && issue.replacementText !== null && (
        <WordDiff before={issue.originalText} after={issue.replacementText} />
      )}
      <div className="kdp-actions kdp-ed-issue-actions">
        {issue.status === "open" ? (
          <>
            {canApply && (
              <button
                type="button"
                className="button primary small"
                disabled={!!busy}
                onClick={() =>
                  void act("apply", { status: "accepted", apply: true })
                }
              >
                {spinner("apply", <CheckCheck size={14} />)} Accept and apply
              </button>
            )}
            <button
              type="button"
              className="button secondary small"
              disabled={!!busy}
              onClick={() =>
                void act("accept", { status: "accepted", apply: false })
              }
            >
              {spinner("accept", <Check size={14} />)} Accept
            </button>
            <button
              type="button"
              className="button ghost small"
              disabled={!!busy}
              onClick={() =>
                void act("reject", { status: "rejected", apply: false })
              }
            >
              {spinner("reject", <X size={14} />)} Reject
            </button>
            <button
              type="button"
              className="button ghost small"
              disabled={!!busy}
              onClick={() =>
                void act("resolve", { status: "resolved", apply: false })
              }
            >
              {spinner("resolve", <Check size={14} />)} Mark resolved
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button ghost small"
            disabled={!!busy}
            onClick={() => void act("reopen", { status: "open", apply: false })}
          >
            {spinner("reopen", <RotateCcw size={14} />)} Reopen
          </button>
        )}
        {canApply && issue.status === "open" && (
          <span className="kdp-muted">
            Accept and apply replaces the quoted text in the chapter.
          </span>
        )}
      </div>
      <div role="status" aria-live="polite">
        {error && <p className="kdp-ed-issue-error">{error}</p>}
      </div>
    </article>
  );
}
