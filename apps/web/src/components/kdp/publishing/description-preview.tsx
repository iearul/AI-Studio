"use client";

import { kdpRules } from "@ai-film-studio/book-engine";
import { createElement, useMemo, type ReactNode } from "react";

type AllowedTag = (typeof kdpRules.metadata.descriptionAllowedTags)[number];
type TagNode = { tag: AllowedTag; children: PreviewNode[] };
type PreviewNode = string | TagNode;

const allowedTags = new Set<string>(kdpRules.metadata.descriptionAllowedTags);
const blockTags = new Set<string>(["p", "h4", "h5", "h6", "ol", "ul"]);
const inlineTags = new Set<string>(["b", "em", "i", "u"]);

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, code: string) => {
      if (code.startsWith("#")) {
        const value =
          code[1] === "x" || code[1] === "X"
            ? Number.parseInt(code.slice(2), 16)
            : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(value) && value > 0 && value < 0x110000
          ? String.fromCodePoint(value)
          : match;
      }
      return namedEntities[code.toLowerCase()] ?? match;
    },
  );
}

/**
 * Parses a KDP description into a tree of the tags KDP allows. Every other
 * tag is dropped (its text stays) and no attribute is ever kept, so the
 * result is safe to render without innerHTML.
 */
export function parseDescription(html: string): PreviewNode[] {
  const root: { tag: "root"; children: PreviewNode[] } = {
    tag: "root",
    children: [],
  };
  const stack: Array<{ tag: string; children: PreviewNode[] }> = [root];
  const top = () => stack[stack.length - 1]!;
  const pushText = (text: string) => {
    if (text) top().children.push(decodeEntities(text));
  };
  let last = 0;
  for (const match of html.matchAll(
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g,
  )) {
    const index = match.index ?? 0;
    pushText(html.slice(last, index));
    last = index + match[0].length;
    const closing = match[1] === "/";
    const tag = (match[2] ?? "").toLowerCase();
    if (!allowedTags.has(tag)) continue;
    const allowed = tag as AllowedTag;
    if (allowed === "br") {
      if (!closing) top().children.push({ tag: "br", children: [] });
      continue;
    }
    if (closing) {
      let position = stack.length - 1;
      while (position > 0 && stack[position]!.tag !== allowed) position -= 1;
      if (position > 0) stack.length = position;
      continue;
    }
    // Browsers close an open paragraph or inline run before a new block.
    if (blockTags.has(allowed)) {
      while (
        stack.length > 1 &&
        (inlineTags.has(top().tag) ||
          ["p", "h4", "h5", "h6"].includes(top().tag))
      ) {
        stack.pop();
      }
    }
    if (allowed === "li" && top().tag === "li") stack.pop();
    const element: TagNode = { tag: allowed, children: [] };
    top().children.push(element);
    stack.push(element);
  }
  pushText(html.slice(last));
  return root.children;
}

/** The description without tags, with line breaks where blocks end. */
export function descriptionPlainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*\/\s*(p|h4|h5|h6|li|ol|ul)\s*>/gi, "\n")
      .replace(/<\s*(p|h4|h5|h6|ol|ul)\b[^>]*>/gi, "\n")
      .replace(/<\s*li\b[^>]*>/gi, "\n• ")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function render(nodes: PreviewNode[], prefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    if (typeof node === "string") return node;
    const key = `${prefix}.${index}`;
    return node.tag === "br"
      ? createElement("br", { key })
      : createElement(node.tag, { key }, ...render(node.children, key));
  });
}

export function DescriptionPreview({ html }: { html: string }) {
  const content = useMemo(() => render(parseDescription(html), "d"), [html]);
  return (
    <div
      className="kdp-meta-preview"
      role="region"
      aria-label="Description preview"
    >
      {html.trim() ? (
        content
      ) : (
        <p className="kdp-muted">Nothing to preview yet.</p>
      )}
    </div>
  );
}
