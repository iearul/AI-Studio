import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GoogleDriveTokenStore } from "../src/google-drive-token-store.js";

describe("GoogleDriveTokenStore", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("persists OAuth credentials in a private local file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "drive-tokens-"));
    directories.push(directory);
    const store = new GoogleDriveTokenStore(path.join(directory, "secrets"));
    const credentials = {
      refreshToken: "refresh-token",
      accessToken: "access-token",
      accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      connectedAt: "2026-09-12T08:00:00.000Z",
      rootFolderId: "root-id",
    };

    await store.save(credentials);

    expect(await store.get()).toEqual(credentials);
    expect((await stat(path.dirname(store.filePath))).mode & 0o777).toBe(0o700);
    expect((await stat(store.filePath)).mode & 0o777).toBe(0o600);
    expect(await readFile(store.filePath, "utf8")).not.toContain(
      "client-secret",
    );

    await store.clear();
    expect(await store.get()).toBeUndefined();
  });

  it("does not accept malformed credential data", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "drive-tokens-"));
    directories.push(directory);
    const store = new GoogleDriveTokenStore(path.join(directory, "secrets"));
    await store.save({
      refreshToken: "refresh-token",
      connectedAt: "2026-09-12T08:00:00.000Z",
    });
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(store.filePath, '{"refreshToken":42}', "utf8"),
    );

    expect(await store.get()).toBeUndefined();
  });
});
