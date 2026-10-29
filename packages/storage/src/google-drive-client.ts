import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import type {
  GoogleDriveTokenStore,
  GoogleDriveCredentials,
} from "./google-drive-token-store.js";

const driveFilesUrl = "https://www.googleapis.com/drive/v3/files";
const driveUploadUrl = "https://www.googleapis.com/upload/drive/v3/files";
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const googleAuthorizationUrl = "https://accounts.google.com/o/oauth2/v2/auth";

export type GoogleDriveConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  md5Checksum?: string;
  webViewLink?: string;
};

export type GoogleDriveWorkspace = {
  rootFolderId: string;
  rootFolderUrl: string;
};

export class GoogleDriveClient {
  constructor(
    private readonly config: GoogleDriveConfig,
    private readonly tokens: GoogleDriveTokenStore,
    private readonly request: typeof fetch = fetch,
  ) {}

  configured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  redirectUri(): string {
    return this.config.redirectUri;
  }

  async connection(): Promise<GoogleDriveCredentials | undefined> {
    const stored = await this.tokens.get();
    if (stored) return stored;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
    if (!refreshToken) return undefined;
    const credentials: GoogleDriveCredentials = {
      refreshToken,
      connectedAt: new Date().toISOString(),
    };
    await this.tokens.save(credentials);
    return credentials;
  }

  authorizationUrl(state: string): string {
    this.requireConfiguration();
    const url = new URL(googleAuthorizationUrl);
    url.search = new URLSearchParams({
      client_id: this.config.clientId!,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<GoogleDriveCredentials> {
    this.requireConfiguration();
    const response = await this.fetchJson(googleTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId!,
        client_secret: this.config.clientSecret!,
        redirect_uri: this.config.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const refreshToken = stringValue(response, "refresh_token");
    const accessToken = stringValue(response, "access_token");
    const expiresIn = numberValue(response, "expires_in");
    if (!refreshToken || !accessToken) {
      throw new GoogleDriveResponseError(
        "Google did not return an offline refresh token. Remove the app from your Google Account connections and try Connect again.",
      );
    }
    const credentials: GoogleDriveCredentials = {
      refreshToken,
      accessToken,
      accessTokenExpiresAt: new Date(
        Date.now() + Math.max(60, expiresIn ?? 3600) * 1000,
      ).toISOString(),
      connectedAt: new Date().toISOString(),
    };
    await this.tokens.save(credentials);
    return credentials;
  }

  async ensureWorkspace(): Promise<GoogleDriveWorkspace> {
    const root = await this.ensureFolder("root", "OSPO");
    await this.ensureFolderPath(root.id, ["AI-Film-Studio", "projects"]);
    await this.ensureFolderPath(root.id, [
      "AI-Film-Studio",
      "backups",
      "database",
    ]);
    const rootFolderUrl =
      root.webViewLink ?? `https://drive.google.com/drive/folders/${root.id}`;
    const current = await this.requireConnection();
    await this.tokens.save({
      ...current,
      rootFolderId: root.id,
      rootFolderUrl,
    });
    return { rootFolderId: root.id, rootFolderUrl };
  }

  async uploadFile(input: {
    localPath: string;
    remotePath: string[];
    mimeType: string;
  }): Promise<DriveFile> {
    if (input.remotePath.length < 2 || input.remotePath[0] !== "OSPO") {
      throw new GoogleDriveConfigurationError(
        "Google Drive uploads must remain inside the OSPO folder.",
      );
    }
    const info = await stat(input.localPath);
    if (!info.isFile()) {
      throw new GoogleDriveConfigurationError(
        "Only regular files can be uploaded to Google Drive.",
      );
    }
    const workspace = await this.ensureWorkspace();
    const folderSegments = input.remotePath.slice(1, -1);
    const parentId = await this.ensureFolderPath(
      workspace.rootFolderId,
      folderSegments,
    );
    const filename = input.remotePath.at(-1)!;
    const existing = await this.findChild(parentId, filename, false);
    const metadata = {
      name: filename,
      parents: existing ? undefined : [parentId],
    };
    const endpoint = existing
      ? `${driveUploadUrl}/${encodeURIComponent(existing.id)}?uploadType=resumable&fields=id,name,mimeType,size,md5Checksum,webViewLink`
      : `${driveUploadUrl}?uploadType=resumable&fields=id,name,mimeType,size,md5Checksum,webViewLink`;
    const session = await this.authorizedFetch(endpoint, {
      method: existing ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(info.size),
      },
      body: JSON.stringify(metadata),
    });
    if (!session.ok) {
      throw await this.responseError(
        session,
        "Google Drive could not start the resumable upload.",
      );
    }
    const location = session.headers.get("location");
    if (!location || !trustedGoogleUploadUrl(location)) {
      throw new GoogleDriveResponseError(
        "Google Drive returned an invalid resumable upload URL.",
      );
    }
    const upload = await this.authorizedFetch(
      location,
      {
        method: "PUT",
        headers: {
          "Content-Type": input.mimeType,
          "Content-Length": String(info.size),
        },
        body: createReadStream(input.localPath) as unknown as BodyInit,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
      false,
    );
    if (!upload.ok) {
      throw await this.responseError(upload, "Google Drive upload failed.");
    }
    return parseDriveFile(await upload.json());
  }

  async markSynced(timestamp = new Date().toISOString()): Promise<void> {
    const current = await this.requireConnection();
    await this.tokens.save({ ...current, lastSyncAt: timestamp });
  }

  async disconnect(): Promise<void> {
    await this.tokens.clear();
  }

  private async ensureFolderPath(
    initialParentId: string,
    segments: string[],
  ): Promise<string> {
    let parentId = initialParentId;
    for (const segment of segments) {
      parentId = (await this.ensureFolder(parentId, segment)).id;
    }
    return parentId;
  }

  private async ensureFolder(
    parentId: string,
    name: string,
  ): Promise<DriveFile> {
    const existing = await this.findChild(parentId, name, true);
    if (existing) return existing;
    const response = await this.authorizedFetch(
      `${driveFilesUrl}?fields=id,name,mimeType,webViewLink`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentId],
          appProperties: { owner: "ai-studio" },
        }),
      },
    );
    if (!response.ok) {
      throw await this.responseError(response, `Could not create ${name}.`);
    }
    return parseDriveFile(await response.json());
  }

  private async findChild(
    parentId: string,
    name: string,
    folder: boolean,
  ): Promise<DriveFile | undefined> {
    const mimeClause = folder
      ? " and mimeType = 'application/vnd.google-apps.folder'"
      : " and mimeType != 'application/vnd.google-apps.folder'";
    const query = `'${escapeDriveQuery(parentId)}' in parents and name = '${escapeDriveQuery(name)}' and trashed = false${mimeClause}`;
    const url = new URL(driveFilesUrl);
    url.search = new URLSearchParams({
      q: query,
      spaces: "drive",
      pageSize: "2",
      fields: "files(id,name,mimeType,size,md5Checksum,webViewLink)",
    }).toString();
    const response = await this.authorizedFetch(url.toString(), {
      method: "GET",
    });
    if (!response.ok) {
      throw await this.responseError(response, `Could not inspect ${name}.`);
    }
    const body = (await response.json()) as unknown;
    if (typeof body !== "object" || body === null) return undefined;
    const files = (body as Record<string, unknown>).files;
    if (!Array.isArray(files) || files.length === 0) return undefined;
    return parseDriveFile(files[0]);
  }

  private async authorizedFetch(
    url: string,
    init: RequestInit,
    retry = true,
  ): Promise<Response> {
    const accessToken = await this.accessToken();
    let response: Response;
    try {
      response = await this.request(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(5 * 60_000),
      });
    } catch (error) {
      throw new GoogleDriveUnavailableError(
        "Google Drive could not be reached. Check the network and try again.",
        { cause: error },
      );
    }
    if (response.status === 401 && retry) {
      await this.accessToken(true);
      return this.authorizedFetch(url, init, false);
    }
    return response;
  }

  private async accessToken(forceRefresh = false): Promise<string> {
    this.requireConfiguration();
    const current = await this.requireConnection();
    if (
      !forceRefresh &&
      current.accessToken &&
      current.accessTokenExpiresAt &&
      Date.parse(current.accessTokenExpiresAt) > Date.now() + 60_000
    ) {
      return current.accessToken;
    }
    const body = await this.fetchJson(googleTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId!,
        client_secret: this.config.clientSecret!,
        refresh_token: current.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const accessToken = stringValue(body, "access_token");
    if (!accessToken) {
      throw new GoogleDriveResponseError(
        "Google did not return an access token. Reconnect Google Drive.",
      );
    }
    const expiresIn = numberValue(body, "expires_in") ?? 3600;
    await this.tokens.save({
      ...current,
      accessToken,
      accessTokenExpiresAt: new Date(
        Date.now() + Math.max(60, expiresIn) * 1000,
      ).toISOString(),
    });
    return accessToken;
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.request(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new GoogleDriveUnavailableError(
        "Google OAuth could not be reached. Check the network and try again.",
        { cause: error },
      );
    }
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throw new GoogleDriveResponseError(
        googleErrorMessage(`Google returned HTTP ${response.status}.`, body),
      );
    }
    return body;
  }

  private async responseError(
    response: Response,
    fallback: string,
  ): Promise<GoogleDriveResponseError> {
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return new GoogleDriveResponseError(googleErrorMessage(fallback, body));
  }

  private requireConfiguration(): void {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new GoogleDriveConfigurationError(
        "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local, then restart the API.",
      );
    }
  }

  private async requireConnection(): Promise<GoogleDriveCredentials> {
    const connection = await this.connection();
    if (!connection) {
      throw new GoogleDriveConfigurationError(
        "Google Drive is not connected. Open Settings and choose Connect Google Drive.",
      );
    }
    return connection;
  }
}

function parseDriveFile(value: unknown): DriveFile {
  if (typeof value !== "object" || value === null) {
    throw new GoogleDriveResponseError(
      "Google Drive returned an invalid file.",
    );
  }
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.name !== "string") {
    throw new GoogleDriveResponseError(
      "Google Drive returned an invalid file.",
    );
  }
  return {
    id: item.id,
    name: item.name,
    mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
    size: typeof item.size === "string" ? item.size : undefined,
    md5Checksum:
      typeof item.md5Checksum === "string" ? item.md5Checksum : undefined,
    webViewLink:
      typeof item.webViewLink === "string" ? item.webViewLink : undefined,
  };
}

function stringValue(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function numberValue(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function escapeDriveQuery(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function googleErrorMessage(
  fallback: string,
  body: Record<string, unknown>,
): string {
  const direct = stringValue(body, "error_description");
  const error = body.error;
  const nested =
    typeof error === "object" && error !== null
      ? stringValue(error, "message")
      : typeof error === "string"
        ? error
        : undefined;
  return direct || nested ? `${fallback} ${direct ?? nested}` : fallback;
}

function trustedGoogleUploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "googleapis.com" ||
        url.hostname.endsWith(".googleapis.com") ||
        url.hostname === "googleusercontent.com" ||
        url.hostname.endsWith(".googleusercontent.com"))
    );
  } catch {
    return false;
  }
}

export function driveMimeType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  return (
    {
      ".json": "application/json",
      ".sqlite": "application/vnd.sqlite3",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".webm": "video/webm",
    }[extension] ?? "application/octet-stream"
  );
}

export class GoogleDriveConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleDriveConfigurationError";
  }
}

export class GoogleDriveUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GoogleDriveUnavailableError";
  }
}

export class GoogleDriveResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleDriveResponseError";
  }
}
