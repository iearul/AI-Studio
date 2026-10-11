import path from "node:path";

import { config as loadEnvironment } from "dotenv";
import { findWorkspaceRoot } from "@ai-film-studio/database";
import { z } from "zod";

const workspaceRoot = findWorkspaceRoot();
loadEnvironment({ path: path.join(workspaceRoot, ".env") });
loadEnvironment({
  path: path.join(workspaceRoot, ".env.local"),
  override: true,
});

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1024).max(65535).default(4100),
  WEB_ORIGIN: z
    .string()
    .default("http://localhost:3000")
    .refine(
      (value) =>
        value.split(",").every((origin) => URL.canParse(origin.trim())),
      "WEB_ORIGIN must be a URL or a comma-separated list of URLs.",
    ),
});

export type ApiConfig = {
  environment: "development" | "test" | "production";
  host: string;
  port: number;
  webOrigins: Set<string>;
};

export function getApiConfig(): ApiConfig {
  const environment = environmentSchema.parse(process.env);
  if (!["127.0.0.1", "localhost", "::1"].includes(environment.API_HOST)) {
    throw new Error(
      "API_HOST must be a loopback address because AI Film Studio is local-only.",
    );
  }
  const configuredOrigins = environment.WEB_ORIGIN.split(",").map(
    (origin) => new URL(origin.trim()).origin,
  );
  return {
    environment: environment.NODE_ENV,
    host: environment.API_HOST,
    port: environment.API_PORT,
    webOrigins: new Set([
      ...configuredOrigins,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]),
  };
}
