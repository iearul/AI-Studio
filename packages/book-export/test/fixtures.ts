import { parseManuscript } from "@ai-studio/book-engine";

import type { ExportManuscript } from "../src/index.js";

/** A small but complete book that exercises every export path. */
export function sampleManuscript(): ExportManuscript {
  return {
    meta: {
      identifier: "6F1C1F0E-8A5B-4B8E-9A43-0D2F1F7F6C11",
      title: "Salt & Shadows",
      subtitle: `A "Harbour" Mystery <Book Two>`,
      authorName: "V. K. Rabenhorst",
      language: "en",
      publisher: "Rabenhorst & Söhne",
      description:
        "A ferry crosses the night. Müller's secret <rides> along & waits.",
      seriesName: "The Harbour Cycle",
      seriesNumber: 2,
      rights: "Copyright © 2026 V. K. Rabenhorst",
      subjects: ["Fiction / Mystery & Detective", "Ferries"],
      modifiedAt: "2026-10-29T09:15:30.123Z",
    },
    sections: [
      {
        id: "title-page",
        kind: "title-page",
        role: "front",
        title: "Title Page",
        showHeading: false,
        includeInToc: false,
        blocks: [],
      },
      {
        id: "copyright",
        kind: "copyright",
        role: "front",
        title: "Copyright",
        showHeading: false,
        includeInToc: false,
        blocks: parseManuscript(
          "Copyright © 2026 V. K. Rabenhorst\n\nAll rights reserved. Cover & design by Jörg Müller.",
        ),
      },
      {
        id: "dedication",
        kind: "dedication",
        role: "front",
        title: "Dedication",
        showHeading: false,
        includeInToc: false,
        blocks: parseManuscript("*For Anna Müller, who kept the lamp lit.*"),
      },
      {
        id: "contents",
        kind: "toc",
        role: "front",
        title: "Contents",
        showHeading: true,
        includeInToc: false,
        blocks: [],
      },
      {
        id: "chapter-1",
        kind: "chapter",
        role: "body",
        title: "Chapter 1: The Night Ferry",
        showHeading: true,
        includeInToc: true,
        blocks: parseManuscript(
          [
            "The ferry left at midnight, and Herr Müller was *not* on it.",
            `"Tom & Jerry's <boat> isn't 'here'," said the harbour master.`,
            "The sign by the gangway read:\nNO PASSENGERS AFTER DARK",
          ].join("\n\n"),
        ),
      },
      {
        id: "chapter-2",
        kind: "chapter",
        role: "body",
        title: "Chapter 2: Salt & Smoke",
        showHeading: true,
        includeInToc: true,
        blocks: parseManuscript(
          [
            "Fog rolled over the pier. **Stop!** someone shouted.",
            "Nobody stopped.",
            "* * *",
            "By morning the *Möwe* had vanished from the timetable.",
          ].join("\n\n"),
        ),
      },
      {
        id: "chapter-3",
        kind: "chapter",
        role: "body",
        title: "Chapter 3: Low Tide",
        showHeading: true,
        includeInToc: true,
        blocks: parseManuscript(
          "At low tide the wreck showed its ribs.\n\nAnna counted them twice.",
        ),
      },
      {
        id: "epilogue",
        kind: "epilogue",
        role: "body",
        title: "Epilogue",
        showHeading: true,
        includeInToc: true,
        blocks: parseManuscript("The lamp still burns on the north pier."),
      },
      {
        id: "about-the-author",
        kind: "about-author",
        role: "back",
        title: "About the Author",
        showHeading: true,
        includeInToc: true,
        blocks: parseManuscript(
          "V. K. Rabenhorst lives by the sea and writes at night.",
        ),
      },
      {
        id: "next-book",
        kind: "next-book-preview",
        role: "back",
        title: "Coming Next: The Lighthouse Keeper",
        showHeading: true,
        includeInToc: true,
        blocks: parseManuscript("*The light went out at 3:12 a.m.*"),
      },
    ],
  };
}

/** A valid 1 × 1 RGBA PNG. */
export function tinyPng(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}
