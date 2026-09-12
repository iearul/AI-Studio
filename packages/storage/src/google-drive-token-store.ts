import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export type GoogleDriveCredentials = {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  rootFolderId?: string;
  rootFolderUrl?: string;
  connectedAt: string;
  lastSyncAt?: string;
};

export class GoogleDriveTokenStore {
  readonly filePath: string;

  constructor(secretsPath: string) {
    this.filePath = path.resolve(secretsPath, "google-drive.json");
  }

  async get(): Promise<GoogleDriveCredentials | undefined> {
    try {
      const value = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as unknown;
      return validCredentials(value) ? value : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(credentials: GoogleDriveCredentials): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(this.filePath), 0o700);
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.filePath);
      await chmod(this.filePath, 0o600);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}

function validCredentials(value: unknown): value is GoogleDriveCredentials {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.refreshToken === "string" &&
    item.refreshToken.length > 0 &&
    typeof item.connectedAt === "string" &&
    !Number.isNaN(Date.parse(item.connectedAt)) &&
    optionalString(item.accessToken) &&
    optionalDate(item.accessTokenExpiresAt) &&
    optionalString(item.rootFolderId) &&
    optionalString(item.rootFolderUrl) &&
    optionalDate(item.lastSyncAt)
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalDate(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && !Number.isNaN(Date.parse(value)))
  );
}
