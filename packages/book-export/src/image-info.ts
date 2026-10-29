export type ImageInfo = {
  format: "jpeg" | "png" | "webp" | "tiff";
  width: number | null;
  height: number | null;
  colorModel: "rgb" | "cmyk" | "grayscale" | "palette" | "unknown";
  hasAlpha: boolean;
  progressive: boolean;
};

/**
 * Reads format, size and colour model from the file header alone, so cover and
 * interior image checks need no image library. Unknown formats return `null`.
 */
export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return inspectJpeg(bytes, view);
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return inspectPng(bytes, view);
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return inspectWebp(bytes, view);
  }
  if (
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return inspectTiff(bytes, view);
  }
  return null;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((byte, index) => bytes[index] === byte)
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return end <= bytes.length
    ? String.fromCharCode(...bytes.subarray(start, end))
    : "";
}

// SOF markers carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the
// range but are not frames.
const progressiveFrames = new Set([0xc2, 0xc6, 0xca, 0xce]);

function inspectJpeg(bytes: Uint8Array, view: DataView): ImageInfo {
  const info: ImageInfo = {
    format: "jpeg",
    width: null,
    height: null,
    colorModel: "unknown",
    hasAlpha: false,
    progressive: false,
  };
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return info;
    let marker = bytes[offset + 1] ?? 0;
    // Any number of 0xFF fill bytes may precede a marker.
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1] ?? 0;
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return info;
    if (offset + 4 > bytes.length) return info;
    const length = view.getUint16(offset + 2);
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrame && offset + 10 <= bytes.length) {
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      const components = bytes[offset + 9] ?? 0;
      info.width = width || null;
      // A height of 0 means it is defined later by a DNL marker.
      info.height = height || null;
      info.colorModel =
        components === 1
          ? "grayscale"
          : components === 3
            ? "rgb"
            : components === 4
              ? "cmyk"
              : "unknown";
      info.progressive = progressiveFrames.has(marker);
      return info;
    }
    if (length < 2) return info;
    offset += 2 + length;
  }
  return info;
}

function inspectPng(bytes: Uint8Array, view: DataView): ImageInfo {
  const info: ImageInfo = {
    format: "png",
    width: null,
    height: null,
    colorModel: "unknown",
    hasAlpha: false,
    progressive: false,
  };
  if (bytes.length < 33 || ascii(bytes, 12, 16) !== "IHDR") return info;
  info.width = view.getUint32(16);
  info.height = view.getUint32(20);
  const colorType = bytes[25];
  info.colorModel =
    colorType === 0 || colorType === 4
      ? "grayscale"
      : colorType === 2 || colorType === 6
        ? "rgb"
        : colorType === 3
          ? "palette"
          : "unknown";
  info.hasAlpha = colorType === 4 || colorType === 6;
  info.progressive = bytes[28] === 1;
  // A tRNS chunk before the image data adds transparency to any other type.
  let offset = 33;
  while (!info.hasAlpha && offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset + 4, offset + 8);
    if (type === "tRNS") info.hasAlpha = true;
    if (type === "IDAT" || type === "IEND") break;
    offset += 12 + view.getUint32(offset);
  }
  return info;
}

function inspectWebp(bytes: Uint8Array, view: DataView): ImageInfo {
  const info: ImageInfo = {
    format: "webp",
    width: null,
    height: null,
    colorModel: "rgb",
    hasAlpha: false,
    progressive: false,
  };
  const chunk = ascii(bytes, 12, 16);
  if (chunk === "VP8 " && bytes.length >= 30) {
    if (bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      info.width = view.getUint16(26, true) & 0x3fff;
      info.height = view.getUint16(28, true) & 0x3fff;
    }
  } else if (chunk === "VP8L" && bytes.length >= 25) {
    if (bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      info.width = (bits & 0x3fff) + 1;
      info.height = ((bits >>> 14) & 0x3fff) + 1;
      info.hasAlpha = ((bits >>> 28) & 1) === 1;
    }
  } else if (chunk === "VP8X" && bytes.length >= 30) {
    info.hasAlpha = ((bytes[20] ?? 0) & 0x10) !== 0;
    info.width = readUint24(bytes, 24) + 1;
    info.height = readUint24(bytes, 27) + 1;
  }
  return info;
}

function readUint24(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function inspectTiff(bytes: Uint8Array, view: DataView): ImageInfo {
  const info: ImageInfo = {
    format: "tiff",
    width: null,
    height: null,
    colorModel: "unknown",
    hasAlpha: false,
    progressive: false,
  };
  const little = bytes[0] === 0x49;
  if (bytes.length < 8) return info;
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > bytes.length) return info;
  const count = view.getUint16(ifd, little);
  let photometric: number | null = null;
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > bytes.length) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    // SHORT (3) values sit in the first two bytes of the value field, LONG (4)
    // values fill it.
    const value =
      type === 3
        ? view.getUint16(entry + 8, little)
        : type === 4
          ? view.getUint32(entry + 8, little)
          : null;
    if (value === null) continue;
    if (tag === 256) info.width = value;
    else if (tag === 257) info.height = value;
    else if (tag === 262) photometric = value;
    else if (tag === 338) info.hasAlpha = value === 1 || value === 2;
  }
  info.colorModel =
    photometric === 0 || photometric === 1
      ? "grayscale"
      : photometric === 2 || photometric === 6
        ? "rgb"
        : photometric === 3
          ? "palette"
          : photometric === 5
            ? "cmyk"
            : "unknown";
  return info;
}
