export type DiffPart = { type: "same" | "added" | "removed"; text: string };

function lcsDiff<T>(
  a: T[],
  b: T[],
  equal: (x: T, y: T) => boolean,
): Array<{ type: DiffPart["type"]; value: T }> {
  const rows = a.length + 1;
  const columns = b.length + 1;
  const table = new Uint32Array(rows * columns);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * columns + j] = equal(a[i]!, b[j]!)
        ? table[(i + 1) * columns + j + 1]! + 1
        : Math.max(table[(i + 1) * columns + j]!, table[i * columns + j + 1]!);
    }
  }
  const result: Array<{ type: DiffPart["type"]; value: T }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (equal(a[i]!, b[j]!)) {
      result.push({ type: "same", value: a[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * columns + j]! >= table[i * columns + j + 1]!) {
      result.push({ type: "removed", value: a[i]! });
      i += 1;
    } else {
      result.push({ type: "added", value: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) result.push({ type: "removed", value: a[i++]! });
  while (j < b.length) result.push({ type: "added", value: b[j++]! });
  return result;
}

function push(parts: DiffPart[], type: DiffPart["type"], text: string) {
  const last = parts[parts.length - 1];
  if (last && last.type === type) last.text += text;
  else parts.push({ type, text });
}

const words = (text: string) => text.match(/\s+|[^\s]+/g) ?? [];

/**
 * Word-level diff. Long texts are compared paragraph by paragraph first, so
 * whole chapters stay fast.
 */
export function diffText(before: string, after: string): DiffPart[] {
  const parts: DiffPart[] = [];
  const paragraphsA = before.split(/\n\n/);
  const paragraphsB = after.split(/\n\n/);
  const blocks = lcsDiff(paragraphsA, paragraphsB, (x, y) => x === y);
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    const separator = index < blocks.length - 1 ? "\n\n" : "";
    const next = blocks[index + 1];
    // A removed paragraph followed by an added one is usually an edit: diff its words.
    if (block.type === "removed" && next?.type === "added") {
      for (const word of lcsDiff(
        words(block.value),
        words(next.value),
        (x, y) => x === y,
      )) {
        push(parts, word.type, word.value);
      }
      push(parts, "same", index + 1 < blocks.length - 1 ? "\n\n" : "");
      index += 1;
      continue;
    }
    push(parts, block.type, block.value + separator);
  }
  return parts.filter((part) => part.text.length > 0);
}

export function changeSummary(parts: DiffPart[]): {
  added: number;
  removed: number;
} {
  const count = (type: DiffPart["type"]) =>
    parts
      .filter((part) => part.type === type)
      .reduce((sum, part) => sum + (part.text.match(/\S+/g)?.length ?? 0), 0);
  return { added: count("added"), removed: count("removed") };
}
