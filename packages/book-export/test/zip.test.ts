import { describe, expect, it } from "vitest";

import { buildZip, readZip } from "../src/index.js";

describe("buildZip / readZip", () => {
  const entries = [
    { path: "mimetype", data: "application/epub+zip", store: true },
    { path: "b/second.txt", data: "Müller & Söhne <ferry>" },
    { path: "a/first.bin", data: new Uint8Array([0, 1, 2, 255]) },
  ];

  it("round-trips text and bytes in the given order", () => {
    const files = readZip(buildZip(entries));
    expect([...files.keys()]).toEqual([
      "mimetype",
      "b/second.txt",
      "a/first.bin",
    ]);
    expect(new TextDecoder().decode(files.get("b/second.txt"))).toBe(
      "Müller & Söhne <ferry>",
    );
    expect(files.get("a/first.bin")).toEqual(new Uint8Array([0, 1, 2, 255]));
  });

  it("stores entries marked as stored and deflates the rest", () => {
    const bytes = buildZip([
      { path: "stored.txt", data: "x".repeat(200), store: true },
      { path: "deflated.txt", data: "x".repeat(200) },
    ]);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint32(18, true)).toBe(200);
    const second = 30 + "stored.txt".length + 200;
    expect(view.getUint32(second, true)).toBe(0x04034b50);
    expect(view.getUint16(second + 8, true)).toBe(8);
  });

  it("produces identical bytes for identical input", () => {
    expect(buildZip(entries)).toEqual(buildZip(entries));
  });

  it("rejects duplicate paths", () => {
    expect(() =>
      buildZip([
        { path: "a.txt", data: "1" },
        { path: "a.txt", data: "2" },
      ]),
    ).toThrow(/twice/);
  });

  it("rejects bytes that are not a ZIP archive", () => {
    expect(() => readZip(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
