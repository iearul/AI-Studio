import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GoogleDriveClient,
  GoogleDriveConfigurationError,
  GoogleDriveResponseError,
} from "../src/google-drive-client.js";
import { GoogleDriveTokenStore } from "../src/google-drive-token-store.js";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri:
    "http://127.0.0.1:4100/api/v1/integrations/google-drive/callback",
};

describe("GoogleDriveClient", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("builds a state-bound, least-privilege OAuth request", async () => {
    const { client } = await createClient();
    const url = new URL(client.authorizationUrl("csrf-state"));

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/drive.file",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("csrf-state");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("stores tokens returned by the authorization-code exchange", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        refresh_token: "refresh-token",
        access_token: "access-token",
        expires_in: 3600,
      }),
    );
    const { client, store } = await createClient(request);

    await client.exchangeCode("authorization-code");

    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    expect((init?.body as URLSearchParams).toString()).toContain(
      "grant_type=authorization_code",
    );
    expect(await store.get()).toMatchObject({
      refreshToken: "refresh-token",
      accessToken: "access-token",
    });
  });

  it("rejects uploads outside the fixed OSPO root", async () => {
    const { client, directory } = await createClient();
    const file = path.join(directory, "frame.png");
    await writeFile(file, "not-needed");

    await expect(
      client.uploadFile({
        localPath: file,
        remotePath: ["Another Folder", "frame.png"],
        mimeType: "image/png",
      }),
    ).rejects.toBeInstanceOf(GoogleDriveConfigurationError);
  });

  it("does not replay a consumed upload stream after an authorization failure", async () => {
    const request = vi.fn<typeof fetch>((url, init) => {
      const target =
        typeof url === "string"
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url;
      if (target.includes("uploadType=resumable")) {
        return Promise.resolve(
          new Response(null, {
            status: 200,
            headers: {
              location:
                "https://www.googleapis.com/upload/drive/v3/files/session-id",
            },
          }),
        );
      }
      if (init?.method === "PUT") {
        return Promise.resolve(
          Response.json({ error: { message: "expired" } }, { status: 401 }),
        );
      }
      const query = new URL(target).searchParams.get("q") ?? "";
      const name = /name = '([^']+)'/.exec(query)?.[1] ?? "folder";
      return Promise.resolve(
        Response.json({
          files: [
            {
              id: `id-${name}`,
              name,
              mimeType: name.includes(".")
                ? "application/json"
                : "application/vnd.google-apps.folder",
            },
          ],
        }),
      );
    });
    const { client, store, directory } = await createClient(request);
    await store.save({
      refreshToken: "refresh-token",
      accessToken: "access-token",
      accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      connectedAt: "2026-09-12T08:00:00.000Z",
    });
    const file = path.join(directory, "project.json");
    await writeFile(file, "{}", "utf8");

    await expect(
      client.uploadFile({
        localPath: file,
        remotePath: [
          "OSPO",
          "AI-Film-Studio",
          "projects",
          "project-1",
          "project.json",
        ],
        mimeType: "application/json",
      }),
    ).rejects.toBeInstanceOf(GoogleDriveResponseError);

    const uploadCalls = request.mock.calls.filter(
      ([, init]) => init?.method === "PUT",
    );
    expect(uploadCalls).toHaveLength(1);
  });

  async function createClient(request: typeof fetch = fetch) {
    const directory = await mkdtemp(path.join(tmpdir(), "drive-client-"));
    directories.push(directory);
    const store = new GoogleDriveTokenStore(path.join(directory, "secrets"));
    return {
      client: new GoogleDriveClient(config, store, request),
      store,
      directory,
    };
  }
});
