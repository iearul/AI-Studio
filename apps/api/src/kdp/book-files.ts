import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Book files live under `<booksRoot>/<bookId>/`. Every path is resolved and
 * checked to stay inside that folder, so stored relative paths can never
 * point elsewhere.
 */
export class BookFileStore {
  constructor(readonly root: string) {}

  bookDirectory(bookId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(bookId)) throw new Error("Invalid book id.");
    return path.join(this.root, bookId);
  }

  absolutePath(bookId: string, relativePath: string): string {
    const base = this.bookDirectory(bookId);
    const resolved = path.resolve(base, relativePath);
    if (!resolved.startsWith(`${base}${path.sep}`)) {
      throw new Error("Path escapes the book folder.");
    }
    return resolved;
  }

  /** Writes atomically (temp file + rename) and returns size and checksum. */
  async write(
    bookId: string,
    relativePath: string,
    data: Uint8Array | string,
  ): Promise<{ relativePath: string; byteSize: number; sha256: string }> {
    const target = this.absolutePath(bookId, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    const bytes =
      typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, target);
    return {
      relativePath,
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async read(bookId: string, relativePath: string): Promise<Buffer> {
    return readFile(this.absolutePath(bookId, relativePath));
  }

  async size(bookId: string, relativePath: string): Promise<number> {
    return (await stat(this.absolutePath(bookId, relativePath))).size;
  }

  async remove(bookId: string, relativePath: string): Promise<void> {
    await rm(this.absolutePath(bookId, relativePath), {
      force: true,
      recursive: true,
    });
  }
}

export function fileSlug(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "book"
  );
}
