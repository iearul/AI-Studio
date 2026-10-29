import { unzipSync, zipSync } from "fflate";
import type { Zippable } from "fflate";

export type ZipEntry = {
  path: string;
  data: Uint8Array | string;
  /** Store without compression (required for the EPUB `mimetype` entry). */
  store?: boolean;
};

// DOS timestamps are local time, so a date built from local fields encodes to
// the same bytes in every time zone, which keeps archives reproducible.
const fixedModified = new Date(2000, 0, 1, 0, 0, 0);
const encoder = new TextEncoder();

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const files = Object.create(null) as Zippable;
  for (const entry of entries) {
    // fflate writes entries in object key order, and JavaScript moves
    // integer-like keys to the front, which would break the EPUB entry order.
    if (/^(?:0|[1-9]\d*)$/.test(entry.path)) {
      throw new Error(`ZIP entry path "${entry.path}" needs a file extension.`);
    }
    if (entry.path in files) {
      throw new Error(`ZIP entry "${entry.path}" is listed twice.`);
    }
    const data =
      typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    files[entry.path] = [
      data,
      { level: entry.store ? 0 : 9, mtime: fixedModified },
    ];
  }
  return zipSync(files);
}

export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(Object.entries(unzipSync(bytes)));
}
