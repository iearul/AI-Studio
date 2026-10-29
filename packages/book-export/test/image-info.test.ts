import { describe, expect, it } from "vitest";

import { inspectImage } from "../src/index.js";
import { tinyPng } from "./fixtures.js";

const be16 = (value: number) => [value >> 8, value & 0xff];
const be32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];
const le16 = (value: number) => [value & 0xff, value >> 8];
const le24 = (value: number) => [
  value & 0xff,
  (value >> 8) & 0xff,
  value >> 16,
];
const le32 = (value: number) => [
  ...le16(value & 0xffff),
  ...le16(value >>> 16),
];
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** SOI, a JFIF APP0 segment and a frame header for a 1600 × 2560 image. */
function jpeg(components: number, frameMarker = 0xc0): Uint8Array {
  const app0 = [
    0xff,
    0xe0,
    ...be16(16),
    ...ascii("JFIF"),
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
  ];
  const frame = [
    0xff,
    frameMarker,
    ...be16(8 + 3 * components),
    8,
    ...be16(2560),
    ...be16(1600),
    components,
    ...Array.from({ length: components }, (_, index) => [
      index + 1,
      0x11,
      0,
    ]).flat(),
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...frame, 0xff, 0xd9]);
}

function png(
  colorType: number,
  extraChunks: number[] = [],
  interlace = 0,
): Uint8Array {
  const ihdr = [...be32(1600), ...be32(2560), 8, colorType, 0, 0, interlace];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...ascii("IHDR"),
    ...ihdr,
    0,
    0,
    0,
    0,
    ...extraChunks,
    ...be32(0),
    ...ascii("IEND"),
    0,
    0,
    0,
    0,
  ]);
}

function webp(chunk: string, payload: number[]): Uint8Array {
  const body = [
    ...ascii("WEBP"),
    ...ascii(chunk),
    ...le32(payload.length),
    ...payload,
  ];
  return new Uint8Array([...ascii("RIFF"), ...le32(body.length), ...body]);
}

describe("inspectImage", () => {
  it("reads RGB, CMYK and grayscale JPEG frames", () => {
    expect(inspectImage(jpeg(3))).toEqual({
      format: "jpeg",
      width: 1600,
      height: 2560,
      colorModel: "rgb",
      hasAlpha: false,
      progressive: false,
    });
    expect(inspectImage(jpeg(4))).toMatchObject({
      colorModel: "cmyk",
      width: 1600,
    });
    expect(inspectImage(jpeg(1))).toMatchObject({ colorModel: "grayscale" });
  });

  it("detects progressive JPEGs", () => {
    expect(inspectImage(jpeg(3, 0xc2))).toMatchObject({
      progressive: true,
      width: 1600,
      height: 2560,
    });
  });

  it("skips a DHT segment, which shares the SOF marker range", () => {
    const base = jpeg(3);
    const dht = [0xff, 0xc4, ...be16(5), 0, 0, 0];
    const bytes = new Uint8Array([
      ...base.subarray(0, 20),
      ...dht,
      ...base.subarray(20),
    ]);
    expect(inspectImage(bytes)).toMatchObject({ width: 1600, height: 2560 });
  });

  it("reads PNG size, colour type, transparency and interlacing", () => {
    expect(inspectImage(png(2))).toEqual({
      format: "png",
      width: 1600,
      height: 2560,
      colorModel: "rgb",
      hasAlpha: false,
      progressive: false,
    });
    expect(inspectImage(png(6))).toMatchObject({
      colorModel: "rgb",
      hasAlpha: true,
    });
    expect(inspectImage(png(0))).toMatchObject({ colorModel: "grayscale" });
    expect(inspectImage(png(3))).toMatchObject({
      colorModel: "palette",
      hasAlpha: false,
    });
    const trns = [...be32(1), ...ascii("tRNS"), 0, 0, 0, 0, 0];
    expect(inspectImage(png(3, trns))).toMatchObject({
      colorModel: "palette",
      hasAlpha: true,
    });
    expect(inspectImage(png(2, [], 1))).toMatchObject({ progressive: true });
    expect(inspectImage(tinyPng())).toMatchObject({
      width: 1,
      height: 1,
      hasAlpha: true,
    });
  });

  it("reads lossy, lossless and extended WebP headers", () => {
    const lossy = webp("VP8 ", [
      0,
      0,
      0,
      0x9d,
      0x01,
      0x2a,
      ...le16(1600),
      ...le16(2560),
      0,
      0,
    ]);
    expect(inspectImage(lossy)).toEqual({
      format: "webp",
      width: 1600,
      height: 2560,
      colorModel: "rgb",
      hasAlpha: false,
      progressive: false,
    });
    const bits = (1600 - 1) | ((2560 - 1) << 14) | (1 << 28);
    const lossless = webp("VP8L", [0x2f, ...le32(bits >>> 0)]);
    expect(inspectImage(lossless)).toMatchObject({
      width: 1600,
      height: 2560,
      hasAlpha: true,
    });
    const extended = webp("VP8X", [
      0x10,
      0,
      0,
      0,
      ...le24(1600 - 1),
      ...le24(2560 - 1),
    ]);
    expect(inspectImage(extended)).toMatchObject({
      width: 1600,
      height: 2560,
      hasAlpha: true,
    });
  });

  it("reads basic TIFF tags", () => {
    const entry = (tag: number, type: number, value: number) => [
      ...le16(tag),
      ...le16(type),
      ...le32(1),
      ...(type === 3 ? [...le16(value), 0, 0] : le32(value)),
    ];
    const tiff = new Uint8Array([
      ...ascii("II"),
      0x2a,
      0,
      ...le32(8),
      ...le16(3),
      ...entry(256, 3, 1600),
      ...entry(257, 4, 2560),
      ...entry(262, 3, 5),
      ...le32(0),
    ]);
    expect(inspectImage(tiff)).toEqual({
      format: "tiff",
      width: 1600,
      height: 2560,
      colorModel: "cmyk",
      hasAlpha: false,
      progressive: false,
    });
  });

  it("returns null for unknown data", () => {
    expect(inspectImage(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(inspectImage(new Uint8Array())).toBeNull();
  });
});
