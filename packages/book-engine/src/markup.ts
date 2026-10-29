/**
 * Manuscript markup is the stored form of chapter text:
 *
 * - paragraphs are separated by one blank line; a single newline inside a
 *   paragraph is a hard line break,
 * - `*italic*`, `**bold**` and `***both***` mark emphasis,
 * - a paragraph that is only `* * *` (or `***`, `⁂`, `#`) is a scene break,
 * - a backslash escapes the next character (`\*` is a literal asterisk).
 *
 * The editor, the exporters and the word counter all go through this module,
 * so a chapter renders identically everywhere.
 */

export type InlineRun = {
  /** Plain text; `\n` is a hard line break. */
  text: string;
  italic: boolean;
  bold: boolean;
};

export type ManuscriptBlock =
  { type: "paragraph"; runs: InlineRun[] } | { type: "scene-break" };

const sceneBreakPattern = /^(?:\*\s*\*\s*\*|⁂|#)$/;

export function parseManuscript(markup: string): ManuscriptBlock[] {
  const normalized = markup.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const blocks: ManuscriptBlock[] = [];
  for (const raw of normalized.split(/\n[ \t]*\n+/)) {
    const text = raw
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
    if (!text) continue;
    if (sceneBreakPattern.test(text)) {
      blocks.push({ type: "scene-break" });
      continue;
    }
    const runs = parseInline(text);
    if (runs.length > 0) blocks.push({ type: "paragraph", runs });
  }
  return blocks;
}

type Token =
  | { kind: "text"; text: string }
  | { kind: "marker"; italic: boolean; bold: boolean; literal: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) tokens.push({ kind: "text", text: buffer });
    buffer = "";
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "\\" && index + 1 < text.length) {
      buffer += text[index + 1];
      index += 1;
      continue;
    }
    if (char !== "*") {
      buffer += char;
      continue;
    }
    let count = 1;
    while (text[index + count] === "*") count += 1;
    const literal = "*".repeat(count);
    index += count - 1;
    if (count > 3) {
      buffer += literal;
      continue;
    }
    flush();
    tokens.push({
      kind: "marker",
      italic: count !== 2,
      bold: count >= 2,
      literal,
    });
  }
  flush();
  return tokens;
}

/** Unpaired emphasis markers are kept as literal asterisks. */
function neutralizeUnpaired(tokens: Token[], key: "italic" | "bold"): void {
  const markers = tokens.flatMap((token, index) =>
    token.kind === "marker" && token[key] ? [index] : [],
  );
  if (markers.length % 2 === 0) return;
  const last = markers[markers.length - 1]!;
  const token = tokens[last] as Extract<Token, { kind: "marker" }>;
  const remaining = { ...token, [key]: false };
  if (!remaining.italic && !remaining.bold) {
    tokens[last] = { kind: "text", text: token.literal };
  } else {
    const kept = remaining.bold ? "**" : "*";
    const dropped = token.literal.slice(kept.length);
    tokens.splice(
      last,
      1,
      { ...remaining, literal: kept },
      { kind: "text", text: dropped },
    );
  }
}

function parseInline(text: string): InlineRun[] {
  const tokens = tokenize(text);
  neutralizeUnpaired(tokens, "italic");
  neutralizeUnpaired(tokens, "bold");
  const runs: InlineRun[] = [];
  let italic = false;
  let bold = false;
  for (const token of tokens) {
    if (token.kind === "marker") {
      if (token.italic) italic = !italic;
      if (token.bold) bold = !bold;
      continue;
    }
    pushRun(runs, { text: token.text, italic, bold });
  }
  return runs;
}

function pushRun(runs: InlineRun[], run: InlineRun): void {
  if (!run.text) return;
  const previous = runs[runs.length - 1];
  if (
    previous &&
    previous.italic === run.italic &&
    previous.bold === run.bold
  ) {
    previous.text += run.text;
    return;
  }
  runs.push({ ...run });
}

function escapeText(text: string): string {
  return text.replace(/[\\*]/g, "\\$&");
}

export function serializeRuns(runs: InlineRun[]): string {
  const merged: InlineRun[] = [];
  for (const run of runs) pushRun(merged, run);
  return merged
    .map((run) => {
      // Emphasis cannot open or close on whitespace without becoming ambiguous,
      // so surrounding spaces stay outside the markers.
      const leading = /^\s*/.exec(run.text)?.[0] ?? "";
      const trailing = /\s*$/.exec(run.text)?.[0] ?? "";
      const core = run.text.slice(
        leading.length,
        run.text.length - trailing.length,
      );
      if (!core || (!run.italic && !run.bold)) return escapeText(run.text);
      const marker = run.bold && run.italic ? "***" : run.bold ? "**" : "*";
      return `${leading}${marker}${escapeText(core)}${marker}${trailing}`;
    })
    .join("");
}

export function serializeManuscript(blocks: ManuscriptBlock[]): string {
  return blocks
    .map((block) =>
      block.type === "scene-break" ? "* * *" : serializeParagraph(block.runs),
    )
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function serializeParagraph(runs: InlineRun[]): string {
  const text = serializeRuns(runs).trim();
  // A paragraph that only reads like a scene-break marker stays a paragraph.
  return sceneBreakPattern.test(text) ? `\\${text}` : text;
}

/** Canonical form: parse and serialize, so equal content compares equal. */
export function normalizeManuscript(markup: string): string {
  return serializeManuscript(parseManuscript(markup));
}

export function blocksToPlainText(blocks: ManuscriptBlock[]): string {
  return blocks
    .map((block) =>
      block.type === "scene-break"
        ? "* * *"
        : block.runs.map((run) => run.text).join(""),
    )
    .join("\n\n");
}

export function manuscriptToPlainText(markup: string): string {
  return blocksToPlainText(parseManuscript(markup));
}

const wordPattern = /[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}'’-]*[\p{L}\p{N}\p{M}])?/gu;

export function countWords(text: string): number {
  return text.match(wordPattern)?.length ?? 0;
}

export function countManuscriptWords(markup: string): number {
  return countWords(manuscriptToPlainText(markup));
}

/** Converts plain model output (no markup) into safe markup. */
export function plainTextToManuscript(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) =>
      sceneBreakPattern.test(paragraph) ? "* * *" : escapeText(paragraph),
    )
    .join("\n\n");
}

// --- TipTap / ProseMirror JSON --------------------------------------------
// The shapes below match TipTap's StarterKit output without importing TipTap,
// so conversions stay testable on the server.

export type RichTextMark = { type: string };
export type RichTextNode = {
  type: string;
  text?: string;
  marks?: RichTextMark[];
  content?: RichTextNode[];
  attrs?: Record<string, unknown>;
};

export function manuscriptToRichText(markup: string): RichTextNode {
  const content: RichTextNode[] = parseManuscript(markup).map((block) => {
    if (block.type === "scene-break") return { type: "horizontalRule" };
    const nodes: RichTextNode[] = [];
    for (const run of block.runs) {
      const marks: RichTextMark[] = [
        ...(run.bold ? [{ type: "bold" }] : []),
        ...(run.italic ? [{ type: "italic" }] : []),
      ];
      run.text.split("\n").forEach((line, index) => {
        if (index > 0) nodes.push({ type: "hardBreak" });
        if (line) {
          nodes.push({
            type: "text",
            text: line,
            ...(marks.length ? { marks } : {}),
          });
        }
      });
    }
    return { type: "paragraph", ...(nodes.length ? { content: nodes } : {}) };
  });
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

export function richTextToManuscript(doc: RichTextNode): string {
  const blocks: ManuscriptBlock[] = [];
  const visit = (node: RichTextNode) => {
    if (node.type === "horizontalRule") {
      blocks.push({ type: "scene-break" });
      return;
    }
    if (node.type === "paragraph" || node.type === "heading") {
      const runs: InlineRun[] = [];
      for (const child of node.content ?? []) {
        if (child.type === "hardBreak") {
          pushRun(runs, { text: "\n", italic: false, bold: false });
        } else if (child.type === "text" && child.text) {
          const marks = new Set((child.marks ?? []).map((mark) => mark.type));
          pushRun(runs, {
            text: child.text,
            italic: marks.has("italic"),
            bold: marks.has("bold"),
          });
        }
      }
      if (runs.some((run) => run.text.trim())) {
        blocks.push({ type: "paragraph", runs });
      }
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return serializeManuscript(blocks);
}
