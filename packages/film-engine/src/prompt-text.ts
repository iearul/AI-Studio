import type { ReferenceView } from "@ai-studio/contracts";

export function detail(
  label: string,
  value: string | number | null,
): string | null {
  if (value === null || value === "") return null;
  return `- ${label}: ${value}`;
}

export function listDetail(label: string, values: string[]): string | null {
  return values.length > 0 ? `- ${label}: ${values.join(", ")}` : null;
}

export function compact(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

export function referenceFilename(
  value: string,
  view: ReferenceView,
  fallback: string,
): string {
  const stem = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${stem || fallback}-${view}-reference.png`;
}
