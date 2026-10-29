"use client";

import type {
  Backup,
  BackupCreationResult,
  DriveSyncResult,
  IntegrationStatus,
  Settings,
  StorageStatus,
} from "@ai-studio/contracts";
import {
  CheckCircle2,
  Cloud,
  CloudUpload,
  Copy,
  Database,
  Download,
  ExternalLink,
  HardDrive,
  Link2,
  LogOut,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { apiBaseUrl, apiFetch, formatBytes } from "@/lib/api";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>();
  const [storage, setStorage] = useState<StorageStatus>();
  const [drive, setDrive] = useState<IntegrationStatus>();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiFetch<Settings>("/settings"),
      apiFetch<StorageStatus>("/storage"),
      apiFetch<IntegrationStatus>("/integrations/google-drive"),
      apiFetch<{ items: Backup[] }>("/backups"),
    ]).then(([nextSettings, nextStorage, nextDrive, nextBackups]) => {
      if (cancelled) return;
      setSettings(nextSettings);
      setStorage(nextStorage);
      setDrive(nextDrive);
      setBackups(nextBackups.items);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setMessage(undefined);
    try {
      setSettings(
        await apiFetch<Settings>("/settings", {
          method: "PATCH",
          body: JSON.stringify(settings),
        }),
      );
      setMessage("Studio settings saved.");
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Could not save settings.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createBackup() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await apiFetch<BackupCreationResult>("/backups", {
        method: "POST",
      });
      setBackups((current) => [result, ...current]);
      setMessage(result.drive.message);
      setStorage(await apiFetch<StorageStatus>("/storage"));
      setDrive(await apiFetch<IntegrationStatus>("/integrations/google-drive"));
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Could not create backup.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function connectDrive() {
    setBusy(true);
    setMessage(undefined);
    const popup = window.open(
      `${apiBaseUrl}/integrations/google-drive/connect`,
      "ai-studio-google-drive",
      "popup,width=620,height=760",
    );
    if (!popup) {
      setMessage("Allow pop-ups for this local app, then try Connect again.");
      setBusy(false);
      return;
    }
    try {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const next = await apiFetch<IntegrationStatus>(
          "/integrations/google-drive",
        );
        setDrive(next);
        if (next.state === "connected") {
          setMessage(
            "Google Drive connected. The visible OSPO folder is ready.",
          );
          popup.close();
          return;
        }
        if (popup.closed) break;
      }
      setMessage(
        "Connection was not completed. Choose Connect Google Drive to try again.",
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Google Drive connection could not be checked.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyDriveRedirectUri() {
    if (!drive) return;
    try {
      await navigator.clipboard.writeText(drive.redirectUri);
      setMessage(
        "Redirect URI copied. Add it unchanged to your Google OAuth Web client.",
      );
    } catch {
      setMessage(
        "Clipboard access was blocked. Select and copy the redirect URI below.",
      );
    }
  }

  async function syncDrive() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await apiFetch<DriveSyncResult>(
        "/integrations/google-drive/sync",
        { method: "POST" },
      );
      setBackups((current) => [result.backup, ...current]);
      setDrive(await apiFetch<IntegrationStatus>("/integrations/google-drive"));
      setMessage(
        `Uploaded ${result.uploadedFiles} files (${formatBytes(result.uploadedBytes)}) to OSPO.`,
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Google Drive sync failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnectDrive() {
    if (
      !window.confirm(
        "Disconnect Google Drive on this Mac? Existing OSPO files will stay in Drive.",
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      await apiFetch("/integrations/google-drive/disconnect", {
        method: "POST",
      });
      setDrive(await apiFetch<IntegrationStatus>("/integrations/google-drive"));
      setMessage(
        "Google Drive disconnected on this Mac. Existing OSPO files were not deleted.",
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Google Drive could not be disconnected.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!settings || !storage || !drive)
    return (
      <div className="page">
        <div className="settings-skeleton" />
      </div>
    );
  return (
    <div className="page settings-page">
      <header className="page-heading compact">
        <div>
          <span className="eyebrow">
            <Settings2 size={14} /> Workspace control
          </span>
          <h1>Settings</h1>
          <p>Configure local storage, portability and studio defaults.</p>
        </div>
      </header>
      {message && (
        <div className="notice success" role="status">
          <CheckCircle2 size={17} />
          <span>{message}</span>
        </div>
      )}
      <div className="settings-layout">
        <form className="settings-card" onSubmit={save}>
          <div className="card-heading">
            <span className="settings-icon">
              <Settings2 size={19} />
            </span>
            <div>
              <h2>Studio defaults</h2>
              <p>Applied when you start a new production.</p>
            </div>
          </div>
          <div className="field-grid">
            <label className="field full">
              <span>Studio name</span>
              <input
                value={settings.studioName}
                onChange={(event) =>
                  setSettings({ ...settings, studioName: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Default language</span>
              <select
                value={settings.defaultLanguage}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    defaultLanguage: event.target
                      .value as Settings["defaultLanguage"],
                  })
                }
              >
                <option value="en">English</option>
                <option value="bn">Bangla</option>
                <option value="de">German</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="field">
              <span>Cost currency</span>
              <select
                value={settings.currency}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    currency: event.target.value as Settings["currency"],
                  })
                }
              >
                <option>EUR</option>
                <option>USD</option>
                <option>GBP</option>
                <option>BDT</option>
              </select>
            </label>
            <label className="field full">
              <span>Google Drive root folder</span>
              <input value={settings.googleDriveFolder} disabled />
              <small>
                Fixed to OSPO so backups and project media always have one
                predictable home.
              </small>
            </label>
            <label className="toggle-row full">
              <input
                type="checkbox"
                checked={settings.automaticBackups}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    automaticBackups: event.target.checked,
                  })
                }
              />
              <span>
                <strong>Automatic backups</strong>
                <small>
                  Enable the policy for the scheduled-backup milestone.
                </small>
              </span>
            </label>
          </div>
          <div className="card-actions">
            <button className="button primary" disabled={busy}>
              <Save size={16} /> Save settings
            </button>
          </div>
        </form>

        <div className="settings-stack">
          <section className="settings-card storage-card">
            <div className="card-heading">
              <span className="settings-icon">
                <HardDrive size={19} />
              </span>
              <div>
                <h2>Local storage</h2>
                <p>Private application state on this Mac.</p>
              </div>
              <span className="health-pill">
                <i /> Healthy
              </span>
            </div>
            <dl className="storage-list">
              <div>
                <dt>
                  <Database size={16} /> Database
                </dt>
                <dd>{formatBytes(storage.databaseSizeBytes)}</dd>
                <small>{storage.databasePath}</small>
              </div>
              <div>
                <dt>
                  <HardDrive size={16} /> Projects
                </dt>
                <dd>
                  {storage.pendingManifestWrites === 0
                    ? "Synced"
                    : `${storage.pendingManifestWrites} pending`}
                </dd>
                <small>{storage.projectsPath}</small>
              </div>
            </dl>
          </section>
          <section className="settings-card drive-card">
            <div className="card-heading">
              <span className="settings-icon">
                <Cloud size={19} />
              </span>
              <div>
                <h2>Google Drive</h2>
                <p>Off-device project and backup storage.</p>
              </div>
            </div>
            <div className="integration-status">
              <span
                className={
                  drive.state === "connected"
                    ? "integration-dot connected"
                    : drive.state === "not_configured"
                      ? "integration-dot idle"
                      : "integration-dot"
                }
              />
              <div>
                <strong>
                  {drive.state === "not_configured"
                    ? "Not configured"
                    : drive.state === "connected"
                      ? "Connected"
                      : "Ready to connect"}
                </strong>
                <p>{drive.message}</p>
                <small>
                  Drive path: OSPO/AI-Film-Studio · permission: drive.file
                </small>
              </div>
            </div>
            {drive.state !== "connected" && (
              <div className="drive-oauth-setup">
                <strong>Required Google OAuth redirect URI</strong>
                <code>{drive.redirectUri}</code>
                <p>
                  Add this exact value under Authorized redirect URIs. Google
                  treats localhost, 127.0.0.1, ports and trailing slashes as
                  different values.
                </p>
                <div className="drive-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void copyDriveRedirectUri()}
                  >
                    <Copy size={16} /> Copy redirect URI
                  </button>
                  <a
                    className="button ghost"
                    href="https://console.cloud.google.com/auth/clients"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={16} /> Google OAuth clients
                  </a>
                </div>
              </div>
            )}
            {drive.state === "ready_to_connect" && (
              <button
                type="button"
                className="button primary drive-action"
                disabled={busy}
                onClick={() => void connectDrive()}
              >
                <Link2 size={16} /> Connect Google Drive
              </button>
            )}
            {drive.state === "connected" && (
              <div className="drive-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={() => void syncDrive()}
                >
                  {busy ? (
                    <RefreshCw className="spin" size={16} />
                  ) : (
                    <CloudUpload size={16} />
                  )}
                  Sync projects &amp; backup
                </button>
                {drive.rootFolderUrl && (
                  <a
                    className="button secondary"
                    href={drive.rootFolderUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={16} /> Open OSPO
                  </a>
                )}
                <button
                  type="button"
                  className="button ghost"
                  disabled={busy}
                  onClick={() => void disconnectDrive()}
                >
                  <LogOut size={16} /> Disconnect
                </button>
                <small className="drive-last-sync">
                  {drive.lastSyncAt
                    ? `Last sync ${new Date(drive.lastSyncAt).toLocaleString()}`
                    : "No full workspace sync yet"}
                </small>
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="settings-card backup-card">
        <div className="card-heading">
          <span className="settings-icon">
            <ShieldCheck size={19} />
          </span>
          <div>
            <h2>Database backups</h2>
            <p>
              Each backup is a consistent SQLite snapshot with a SHA-256
              integrity record.
            </p>
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void createBackup()}
          >
            {busy ? (
              <RefreshCw className="spin" size={16} />
            ) : (
              <Download size={16} />
            )}{" "}
            Backup now
          </button>
        </div>
        {backups.length === 0 ? (
          <div className="backup-empty">
            <Database size={21} />
            <span>
              No backups yet. Create one before making irreplaceable changes.
            </span>
          </div>
        ) : (
          <div className="backup-list">
            {backups.map((backup) => (
              <div key={backup.id} className="backup-row">
                <span className="backup-symbol">
                  <Database size={17} />
                </span>
                <div>
                  <strong>{new Date(backup.createdAt).toLocaleString()}</strong>
                  <small>{backup.filename}</small>
                </div>
                <span>{formatBytes(backup.sizeBytes)}</span>
                <span className="checksum" title={backup.checksumSha256}>
                  SHA-256 verified
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
