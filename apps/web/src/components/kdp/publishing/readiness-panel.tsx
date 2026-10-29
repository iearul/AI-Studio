"use client";

import {
  readinessAreas,
  type BookReadiness,
  type ReadinessCheck,
} from "@ai-studio/contracts";
import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";

import { Pill } from "@/components/kdp/kdp-ui";
import { formatDate, kdpPath, kdpSend } from "@/lib/kdp";

import { CheckStatus, StatusLine, useAction } from "./shared";

export const areaLabels: Record<ReadinessCheck["area"], string> = {
  manuscript: "Manuscript",
  editorial: "Editorial",
  cover: "Cover",
  metadata: "Listing",
  files: "Files",
  disclosure: "AI disclosure",
  rights: "Rights",
};

const statusRank = { fail: 0, warn: 1, pass: 2 } as const;

function ApprovalRow({
  label,
  hint,
  approved,
  busy,
  disabled,
  onToggle,
}: {
  label: string;
  hint: string;
  approved: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="kdp-pub-approval">
      <div>
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      {approved ? (
        <Pill tone="good">
          <CheckCircle2 size={12} aria-hidden="true" /> Approved
        </Pill>
      ) : (
        <Pill tone="warn">Not approved</Pill>
      )}
      <button
        type="button"
        className={approved ? "button ghost small" : "button secondary small"}
        disabled={disabled}
        onClick={onToggle}
      >
        {busy && <LoaderCircle size={13} className="spin" />}
        {approved ? "Withdraw" : "Approve"}
      </button>
    </div>
  );
}

export function ReadinessPanel({
  bookId,
  readiness,
  onChange,
}: {
  bookId: string;
  readiness: BookReadiness;
  onChange: (readiness: BookReadiness) => void;
}) {
  const { busy, status, run } = useAction();
  const open = readiness.checks
    .filter((check) => check.status !== "pass")
    .sort((a, b) => statusRank[a.status] - statusRank[b.status]);
  const failing = open.filter((check) => check.status === "fail").length;

  const approve = (field: "manuscript" | "listing", approved: boolean) =>
    void run(field, async () => {
      const result = await kdpSend<BookReadiness>(
        kdpPath(bookId, "/approval"),
        "POST",
        {
          field,
          approved,
        },
      );
      onChange(result);
      const name = field === "manuscript" ? "Manuscript" : "Listing";
      return approved ? `${name} approved.` : `${name} approval withdrawn.`;
    });

  return (
    <section
      className="kdp-card kdp-pub-readiness"
      aria-labelledby="kdp-pub-readiness-title"
    >
      <header>
        <div>
          <h2 id="kdp-pub-readiness-title">Readiness</h2>
          <p>
            KDP rules version {readiness.rulesVersion}, verified{" "}
            {formatDate(readiness.rulesVerifiedAt)}. KDP changes its rules;
            check anything that looks different on its site.
          </p>
        </div>
        {readiness.readyForKdp ? (
          <Pill tone="good">
            <ShieldCheck size={12} aria-hidden="true" /> Ready for KDP
          </Pill>
        ) : readiness.technicalChecksPass ? (
          <Pill tone="warn">Waiting for your approval</Pill>
        ) : (
          <Pill tone="bad">{failing} to fix</Pill>
        )}
      </header>

      <div className="kdp-pub-approvals">
        <ApprovalRow
          label="Manuscript"
          hint="You have read the whole book and accept it as final."
          approved={readiness.manuscriptApproved}
          busy={busy === "manuscript"}
          disabled={!!busy}
          onToggle={() => approve("manuscript", !readiness.manuscriptApproved)}
        />
        <ApprovalRow
          label="Listing"
          hint="Title, description, keywords, categories and price are checked."
          approved={readiness.listingApproved}
          busy={busy === "listing"}
          disabled={!!busy}
          onToggle={() => approve("listing", !readiness.listingApproved)}
        />
      </div>
      <StatusLine status={status} />

      {open.length > 0 && (
        <div className="kdp-pub-todo">
          <h3>Before you publish</h3>
          <ul>
            {open.map((check) => (
              <li key={check.id}>
                <CheckStatus status={check.status} />
                <div>
                  <strong>
                    {areaLabels[check.area]}: {check.label}
                  </strong>
                  <p>{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="kdp-details kdp-pub-all-checks">
        <summary>All checks ({readiness.checks.length})</summary>
        <div className="kdp-pub-areas">
          {readinessAreas.map((area) => {
            const checks = readiness.checks.filter(
              (check) => check.area === area,
            );
            if (checks.length === 0) return null;
            return (
              <div key={area} className="kdp-pub-area">
                <h4>{areaLabels[area]}</h4>
                <ul>
                  {checks.map((check) => (
                    <li key={check.id}>
                      <CheckStatus status={check.status} />
                      <div>
                        <strong>{check.label}</strong>
                        <p>{check.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}
