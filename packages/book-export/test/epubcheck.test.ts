import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildEpub,
  buildZip,
  findEpubCheck,
  readZip,
  runEpubCheck,
} from "../src/index.js";
import { sampleManuscript, tinyPng } from "./fixtures.js";

const binary = await findEpubCheck();

let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "book-export-epubcheck-"));
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function writeEpub(name: string, bytes: Uint8Array): Promise<string> {
  const file = path.join(directory, name);
  await writeFile(file, bytes);
  return file;
}

describe("runEpubCheck", () => {
  it("reports a missing binary instead of throwing", async () => {
    const file = await writeEpub("missing.epub", buildEpub(sampleManuscript()));
    const result = await runEpubCheck(file, {
      binary: path.join(directory, "no-such-epubcheck"),
    });
    expect(result).toEqual({
      available: false,
      version: null,
      passed: false,
      counts: { fatal: 0, error: 0, warning: 0, info: 0 },
      messages: [],
    });
  });

  it.skipIf(!binary)(
    "passes EPUBCheck without fatal errors or errors",
    async () => {
      const file = await writeEpub(
        "sample.epub",
        buildEpub(sampleManuscript()),
      );
      const result = await runEpubCheck(file);
      expect(result.available).toBe(true);
      expect(result.version).toMatch(/^\d+\.\d+/);
      expect(
        result.messages.filter((message) =>
          ["FATAL", "ERROR"].includes(message.severity),
        ),
      ).toEqual([]);
      expect(result.counts.fatal).toBe(0);
      expect(result.counts.error).toBe(0);
      expect(result.passed).toBe(true);
    },
    60_000,
  );

  it.skipIf(!binary)(
    "passes EPUBCheck with an embedded cover",
    async () => {
      const file = await writeEpub(
        "cover.epub",
        buildEpub(sampleManuscript(), {
          cover: { bytes: tinyPng(), mimeType: "image/png" },
        }),
      );
      const result = await runEpubCheck(file);
      expect(result.counts).toMatchObject({ fatal: 0, error: 0 });
      expect(result.passed).toBe(true);
    },
    60_000,
  );

  it.skipIf(!binary)(
    "fails a broken EPUB and reports where",
    async () => {
      const files = readZip(buildEpub(sampleManuscript()));
      files.delete("OEBPS/text/chapter-2.xhtml");
      const broken = buildZip(
        [...files].map(([entry, data]) => ({
          path: entry,
          data,
          store: entry === "mimetype",
        })),
      );
      const result = await runEpubCheck(await writeEpub("broken.epub", broken));
      expect(result.available).toBe(true);
      expect(result.passed).toBe(false);
      expect(result.counts.error + result.counts.fatal).toBeGreaterThan(0);
      expect(result.messages).toContainEqual(
        expect.objectContaining({
          severity: "ERROR",
          location: expect.stringContaining("OEBPS/") as unknown,
        }),
      );
    },
    60_000,
  );
});
