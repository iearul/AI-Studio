import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type EpubCheckMessage = {
  severity: string;
  id: string;
  message: string;
  location?: string;
};

export type EpubCheckResult = {
  available: boolean;
  version: string | null;
  /** No FATAL or ERROR messages. Warnings and usage notes do not fail. */
  passed: boolean;
  counts: { fatal: number; error: number; warning: number; info: number };
  messages: EpubCheckMessage[];
};

export type EpubCheckOptions = {
  binary?: string;
  timeoutMs?: number;
};

const defaultTimeoutMs = 120_000;

/**
 * The binary from the option, else `EPUBCHECK_PATH`, else `epubcheck` on PATH.
 * An explicit setting is not second-guessed: if it is wrong, the result is
 * `null` rather than a different binary.
 */
export async function findEpubCheck(binary?: string): Promise<string | null> {
  const explicit = binary ?? process.env.EPUBCHECK_PATH;
  const candidates = explicit
    ? [explicit]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, "epubcheck"));
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}

async function isExecutableFile(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Runs EPUBCheck on a file. A missing EPUBCheck is a normal state on machines
 * without it and returns `available: false`; a run that times out or produces
 * no report throws.
 */
export async function runEpubCheck(
  epubPath: string,
  options: EpubCheckOptions = {},
): Promise<EpubCheckResult> {
  const binary = await findEpubCheck(options.binary);
  if (!binary) {
    return {
      available: false,
      version: null,
      passed: false,
      counts: { fatal: 0, error: 0, warning: 0, info: 0 },
      messages: [],
    };
  }
  const timeout = options.timeoutMs ?? defaultTimeoutMs;
  const directory = await mkdtemp(path.join(os.tmpdir(), "epubcheck-"));
  const reportPath = path.join(directory, "report.json");
  try {
    try {
      await execFileAsync(
        binary,
        [path.resolve(epubPath), "--json", reportPath, "--quiet"],
        { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      );
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        killed?: boolean;
        stderr?: string;
      };
      if (failure.killed) {
        throw new Error(`EPUBCheck did not finish within ${timeout} ms.`);
      }
      // EPUBCheck exits with 1 whenever it finds errors; the report is still
      // written, so only a missing report is a failed run.
      if (!(await isReadable(reportPath))) {
        const detail = failure.stderr?.trim() || failure.message;
        throw new Error(`EPUBCheck failed to run: ${detail}`);
      }
    }
    const report: unknown = JSON.parse(await readFile(reportPath, "utf8"));
    return readReport(report);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function isReadable(file: string): Promise<boolean> {
  try {
    await access(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

type RawLocation = { path?: unknown; line?: unknown; column?: unknown };
type RawMessage = {
  ID?: unknown;
  severity?: unknown;
  message?: unknown;
  locations?: unknown;
};

function readReport(report: unknown): EpubCheckResult {
  const root = asRecord(report);
  const checker = asRecord(root.checker);
  const counts = { fatal: 0, error: 0, warning: 0, info: 0 };
  const messages: EpubCheckMessage[] = [];
  const rawMessages = Array.isArray(root.messages)
    ? (root.messages as unknown[])
    : [];
  for (const raw of rawMessages) {
    const message = asRecord(raw) as RawMessage;
    const severity =
      typeof message.severity === "string" ? message.severity : "INFO";
    const base = {
      severity,
      id: typeof message.ID === "string" ? message.ID : "",
      message: typeof message.message === "string" ? message.message : "",
    };
    // One report entry stands for every place the same problem occurs.
    const locations = Array.isArray(message.locations)
      ? (message.locations as unknown[]).map((location) =>
          formatLocation(asRecord(location) as RawLocation),
        )
      : [];
    const occurrences = locations.length > 0 ? locations : [null];
    for (const location of occurrences) {
      messages.push(location ? { ...base, location } : base);
      if (severity === "FATAL") counts.fatal += 1;
      else if (severity === "ERROR") counts.error += 1;
      else if (severity === "WARNING") counts.warning += 1;
      else counts.info += 1;
    }
  }
  return {
    available: true,
    version:
      typeof checker.checkerVersion === "string"
        ? checker.checkerVersion
        : null,
    passed: counts.fatal === 0 && counts.error === 0,
    counts,
    messages,
  };
}

function formatLocation(location: RawLocation): string {
  const file = typeof location.path === "string" ? location.path : "";
  const line =
    typeof location.line === "number" && location.line > 0
      ? location.line
      : null;
  const column =
    typeof location.column === "number" && location.column > 0
      ? location.column
      : null;
  return [file, line, line !== null ? column : null]
    .filter((part) => part !== null && part !== "")
    .join(":");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
