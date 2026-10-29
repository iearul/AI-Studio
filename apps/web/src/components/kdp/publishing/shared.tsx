"use client";

import type {
  BookExport,
  CoverAsset,
  CoverConcept,
  MetadataGeneration,
  BookMetadataRecord,
  ProvenanceClass,
  ProvenanceRecord,
  ReadinessCheck,
} from "@ai-studio/contracts";
import type {
  DisclosureAnswer,
  MetadataFinding,
  RoyaltyEstimate,
  kdpRules,
} from "@ai-studio/book-engine";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { CopyButton, Pill } from "@/components/kdp/kdp-ui";
import { errorMessage } from "@/lib/kdp";

// --- API response shapes --------------------------------------------------------

export type CoverRules = typeof kdpRules.cover;

export type CoversResponse = {
  items: CoverAsset[];
  concepts: { id: string; data: CoverConcept[]; createdAt: string } | null;
  rules: CoverRules;
};

export type MetadataResponse = {
  record: BookMetadataRecord | null;
  suggestion: {
    id: string;
    data: MetadataGeneration;
    createdAt: string;
  } | null;
  findings: MetadataFinding[];
  consistency: MetadataFinding[];
  royalty: RoyaltyEstimate | null;
  rules: {
    version: string;
    verifiedAt: string;
    metadata: typeof kdpRules.metadata;
    pricing: typeof kdpRules.pricing;
    kdpSelect: typeof kdpRules.kdpSelect;
  };
};

export type ProvenanceResponse = {
  records: ProvenanceRecord[];
  checklist: DisclosureAnswer[];
  rulesVersion?: string;
};

export type ExportsResponse = { items: BookExport[] };

// --- Labels ---------------------------------------------------------------------

export const provenanceLabels: Record<ProvenanceClass, string> = {
  human: "Made by a person",
  "ai-assisted": "AI-assisted",
  "ai-generated": "AI-generated",
  unknown: "Unknown",
  "not-applicable": "Not applicable",
};

export const provenanceHints: Record<ProvenanceClass, string> = {
  human: "Created by you or a person you hired, without AI generation.",
  "ai-assisted": "Made by a person; AI only helped edit or refine it.",
  "ai-generated": "Created by an AI tool, even if you edited it afterwards.",
  unknown: "You are not sure who or what made it.",
  "not-applicable": "This book has none.",
};

/** The classes a person can choose for an image they add. */
export const imageProvenanceOptions: ProvenanceClass[] = [
  "ai-generated",
  "ai-assisted",
  "human",
  "unknown",
];

export function provenanceTone(value: ProvenanceClass) {
  return value === "ai-generated"
    ? "accent"
    : value === "unknown"
      ? "warn"
      : value === "human"
        ? "good"
        : "neutral";
}

// --- Hooks ----------------------------------------------------------------------

/** Reloads page data whenever a background job of this book finishes. */
export function useReloadOnSettle(
  settledVersion: number,
  reload: () => Promise<void>,
) {
  useEffect(() => {
    if (settledVersion === 0) return;
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [settledVersion, reload]);
}

export type StatusText = { tone: "error" | "success"; text: string };

/**
 * Runs one user action at a time and keeps its result message. The action
 * returns an optional success message.
 */
export function useAction() {
  const [busy, setBusy] = useState<string>();
  const [status, setStatus] = useState<StatusText>();
  const run = useCallback(
    async (
      key: string,
      action: () => Promise<string | void>,
    ): Promise<boolean> => {
      setBusy(key);
      setStatus(undefined);
      try {
        const text = await action();
        if (text) setStatus({ tone: "success", text });
        return true;
      } catch (reason) {
        setStatus({ tone: "error", text: errorMessage(reason) });
        return false;
      } finally {
        setBusy(undefined);
      }
    },
    [],
  );
  return { busy, status, setStatus, run };
}

// --- Small components -----------------------------------------------------------

/** Always-mounted live region so screen readers announce results. */
export function StatusLine({
  status,
  className = "",
}: {
  status: StatusText | undefined;
  className?: string;
}) {
  return (
    <div
      className={`kdp-pub-status ${className}`}
      role="status"
      aria-live="polite"
    >
      {status && (
        <p className={`notice ${status.tone}`}>
          <span>{status.text}</span>
        </p>
      )}
    </div>
  );
}

export function CheckStatus({ status }: { status: ReadinessCheck["status"] }) {
  if (status === "pass")
    return (
      <Pill tone="good">
        <CheckCircle2 size={12} aria-hidden="true" /> Done
      </Pill>
    );
  if (status === "warn")
    return (
      <Pill tone="warn">
        <AlertTriangle size={12} aria-hidden="true" /> Check
      </Pill>
    );
  return (
    <Pill tone="bad">
      <XCircle size={12} aria-hidden="true" /> Fix
    </Pill>
  );
}

export function FindingList({
  findings,
  empty,
}: {
  findings: MetadataFinding[];
  empty?: ReactNode;
}) {
  if (findings.length === 0) return empty ? <>{empty}</> : null;
  return (
    <ul className="kdp-meta-findings">
      {findings.map((finding, index) => (
        <li key={`${finding.field}-${index}`} className={finding.level}>
          {finding.level === "error" ? (
            <XCircle size={14} aria-hidden="true" />
          ) : (
            <AlertTriangle size={14} aria-hidden="true" />
          )}
          <span>
            <span className="kdp-pub-sr">
              {finding.level === "error" ? "Error: " : "Warning: "}
            </span>
            {finding.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One value to copy into a KDP field. Empty required values say "Missing";
 * empty optional values say "Not set".
 */
export function CopyField({
  label,
  value,
  optional = false,
  hint,
  long = false,
}: {
  label: string;
  value: string | null | undefined;
  optional?: boolean;
  hint?: ReactNode;
  long?: boolean;
}) {
  const text = value?.trim() ?? "";
  return (
    <div className={`kdp-pub-field ${long ? "long" : ""}`}>
      <dt>{label}</dt>
      <dd>
        {text ? (
          <span className="kdp-pub-value">{text}</span>
        ) : optional ? (
          <span className="kdp-pub-empty">Not set (optional)</span>
        ) : (
          <Pill tone="bad">Missing</Pill>
        )}
        {hint && <small>{hint}</small>}
      </dd>
      <div className="kdp-pub-copy">
        {text && <CopyButton value={text} label="Copy" />}
      </div>
    </div>
  );
}

export function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1) return `${megabytes.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
