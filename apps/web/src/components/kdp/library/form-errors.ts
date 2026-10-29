import { ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/kdp";

function labelFromPath(path: string): string {
  const last =
    path
      .split(".")
      .filter((part) => !/^\d+$/.test(part))
      .pop() ?? path;
  const words = last.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Turns an API validation problem into one line per field, using friendly
 * field names instead of payload paths.
 */
export function readableErrors(
  reason: unknown,
  labels: Record<string, string>,
  fallback?: string,
): string[] {
  if (reason instanceof ApiError && reason.problem?.errors) {
    return Object.entries(reason.problem.errors).map(([field, messages]) => {
      const label = labels[field] ?? labelFromPath(field);
      return `${label}: ${messages.join(" ")}`;
    });
  }
  return [errorMessage(reason, fallback)];
}

export type NumberRule = { min: number; max: number; integer?: boolean };

/** Parses a number typed into a form; undefined when empty or out of range. */
export function parseNumber(
  text: string,
  rule: NumberRule,
): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  if (rule.integer && !Number.isInteger(value)) return undefined;
  if (value < rule.min || value > rule.max) return undefined;
  return value;
}
