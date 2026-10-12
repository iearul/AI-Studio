import { createReadStream } from "node:fs";

import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Streams a project media file with byte-range support, which Safari requires
 * to play and seek audio and video.
 */
export function sendRangedFile(
  request: FastifyRequest,
  reply: FastifyReply,
  file: { absolutePath: string; size: number; mimeType: string },
  invalidRange: () => Error,
): FastifyReply {
  const range = parseRange(request.headers.range, file.size, invalidRange);
  void reply
    .type(file.mimeType)
    .header("Accept-Ranges", "bytes")
    .header("Cache-Control", "private, max-age=3600, immutable")
    .header("Cross-Origin-Resource-Policy", "cross-origin");
  if (!range) {
    return reply
      .header("Content-Length", file.size)
      .send(createReadStream(file.absolutePath));
  }
  return reply
    .status(206)
    .header("Content-Length", range.end - range.start + 1)
    .header("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`)
    .send(createReadStream(file.absolutePath, range));
}

function parseRange(
  value: string | undefined,
  size: number,
  invalidRange: () => Error,
): { start: number; end: number } | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value.trim());
  if (!match) throw invalidRange();
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    throw invalidRange();
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}
