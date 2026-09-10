import { z } from "zod";

export const settingsSchema = z.object({
  studioName: z.string().trim().min(2).max(80),
  currency: z.enum(["EUR", "USD", "GBP", "BDT"]),
  defaultLanguage: z.enum(["bn", "en", "de", "other"]),
  automaticBackups: z.boolean(),
  backupRetentionDays: z.number().int().min(1).max(365),
  googleDriveFolder: z.string().trim().min(1).max(180),
});

export const updateSettingsSchema = settingsSchema.partial();

export const backupSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  kind: z.enum(["manual", "automatic", "pre_restore"]),
  sizeBytes: z.number().int().nonnegative(),
  checksumSha256: z.string().length(64),
  createdAt: z.iso.datetime(),
});

export const backupListSchema = z.object({
  items: z.array(backupSchema),
});

export const restoreBackupSchema = z.object({
  confirmation: z.literal("RESTORE"),
});

export const storageStatusSchema = z.object({
  databasePath: z.string(),
  projectsPath: z.string(),
  backupsPath: z.string(),
  databaseSizeBytes: z.number().int().nonnegative(),
  pendingManifestWrites: z.number().int().nonnegative(),
});

export const integrationStatusSchema = z.object({
  provider: z.literal("google-drive"),
  state: z.enum(["not_configured", "ready_to_connect", "connected"]),
  folder: z.string(),
  message: z.string(),
});

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string().optional(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type Backup = z.infer<typeof backupSchema>;
export type StorageStatus = z.infer<typeof storageStatusSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
