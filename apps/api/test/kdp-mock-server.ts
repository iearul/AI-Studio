// Runs the real API with a throwaway database and the scripted mock book
// provider, so the KDP Story Studio UI can be checked without any provider key:
//   pnpm --filter @ai-film-studio/api kdp:mock
// then start the web app with NEXT_PUBLIC_API_URL=http://127.0.0.1:4210/api/v1.
import path from "node:path";

import { findWorkspaceRoot } from "@ai-film-studio/database";
import type {
  TextCompletionRequest,
  TextGenerationRequest,
} from "@ai-film-studio/providers";

const root = path.join(findWorkspaceRoot(), "tmp", "kdp-mock");
process.env.NODE_ENV = "development";
process.env.DATABASE_PATH = path.join(root, "film-studio.sqlite");
process.env.PROJECTS_PATH = path.join(root, "projects");
process.env.BACKUPS_PATH = path.join(root, "backups");
process.env.CACHE_PATH = path.join(root, "cache");
process.env.SECRETS_PATH = path.join(root, "secrets");
process.env.API_PORT = process.env.KDP_MOCK_PORT ?? "4210";
process.env.WEB_ORIGIN = "http://localhost:3210,http://127.0.0.1:3210";

// config.ts loads .env.local; every key is removed before services start.
const { getApiConfig } = await import("../src/config.js");
for (const key of Object.keys(process.env)) {
  if (/(_API_KEY|CLIENT_ID|CLIENT_SECRET|REFRESH_TOKEN)$/.test(key)) {
    delete process.env[key];
  }
}
const { createServices } = await import("../src/services.js");
const { buildApp } = await import("../src/app.js");
const { MockBookProvider } = await import("./kdp-helpers.js");

/** Adds a delay so job progress is visible in the UI. */
class SlowMockProvider extends MockBookProvider {
  override async complete(request: TextCompletionRequest) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return super.complete(request);
  }

  override async generate(request: TextGenerationRequest) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return super.generate(request);
  }
}

const config = getApiConfig();
const services = await createServices({
  textProviders: [],
  imageProviders: [],
  videoProviders: [],
  kdpTextProviders: [
    new SlowMockProvider("anthropic"),
    new SlowMockProvider("openai"),
  ],
});
const app = await buildApp(config, services);
await app.listen({ host: config.host, port: config.port });
console.log(
  `KDP mock API on http://${config.host}:${config.port} — mock AI, no provider keys, data in ${root}`,
);
