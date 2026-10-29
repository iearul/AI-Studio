"use client";

import { useMemo } from "react";

type Segment = { type: "same" | "removed" | "added"; text: string };

const maxTokens = 900;

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/** Word-level diff by longest common subsequence; null when too long. */
export function diffWords(before: string, after: string): Segment[] | null {
  const left = tokenize(before);
  const right = tokenize(after);
  if (left.length > maxTokens || right.length > maxTokens) return null;
  const columns = right.length + 1;
  const table = new Uint16Array((left.length + 1) * columns);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i * columns + j] =
        left[i] === right[j]
          ? table[(i + 1) * columns + j + 1]! + 1
          : Math.max(
              table[(i + 1) * columns + j]!,
              table[i * columns + j + 1]!,
            );
    }
  }
  const segments: Segment[] = [];
  const push = (type: Segment["type"], text: string) => {
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += text;
    else segments.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push("same", left[i]!);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * columns + j]! >= table[i * columns + j + 1]!) {
      push("removed", left[i]!);
      i += 1;
    } else {
      push("added", right[j]!);
      j += 1;
    }
  }
  while (i < left.length) push("removed", left[i++]!);
  while (j < right.length) push("added", right[j++]!);
  return segments;
}

/** Before and after side by side, with removed and added words marked. */
export function WordDiff({ before, after }: { before: string; after: string }) {
  const segments = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <div className="kdp-ed-diff">
      <div>
        <span className="kdp-ed-diff-label">Before</span>
        <p>
          {segments
            ? segments
                .filter((segment) => segment.type !== "added")
                .map((segment, index) =>
                  segment.type === "removed" ? (
                    <del key={index}>{segment.text}</del>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )
            : before}
        </p>
      </div>
      <div>
        <span className="kdp-ed-diff-label">After</span>
        <p>
          {after.length === 0 ? (
            <em className="kdp-muted">Remove the passage.</em>
          ) : segments ? (
            segments
              .filter((segment) => segment.type !== "removed")
              .map((segment, index) =>
                segment.type === "added" ? (
                  <ins key={index}>{segment.text}</ins>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )
          ) : (
            after
          )}
        </p>
      </div>
    </div>
  );
}
