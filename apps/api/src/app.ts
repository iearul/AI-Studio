import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";

import type { ApiConfig } from "./config.js";
import { registerErrorHandler } from "./errors.js";
import { registerBibleRoutes } from "./routes/bible.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerGenerationRoutes } from "./routes/generations.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerStoryPlanRoutes } from "./routes/story-plans.js";
import type { Services } from "./services.js";

export async function buildApp(
  config: ApiConfig,
  services: Services,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.environment === "test"
        ? false
        : { level: config.environment === "development" ? "info" : "warn" },
    bodyLimit: 1024 * 1024,
    trustProxy: false,
    requestIdHeader: false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(cors, {
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      try {
        const parsed = new URL(origin);
        const developmentLoopback =
          config.environment === "development" &&
          ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
          /^3\d{3}$/.test(parsed.port);
        callback(
          null,
          config.webOrigins.has(parsed.origin) || developmentLoopback,
        );
      } catch {
        callback(null, false);
      }
    },
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 8 * 1024 * 1024, parts: 1 },
  });

  registerErrorHandler(app);
  await app.register(
    (api) => {
      registerProjectRoutes(api, services);
      registerStoryPlanRoutes(api, services);
      registerBibleRoutes(api, services);
      registerGenerationRoutes(api, services);
      registerSystemRoutes(api, services);
      registerChatRoutes(api);
    },
    { prefix: "/api/v1" },
  );
  if (config.environment !== "test") {
    services.imageGenerations.start();
    app.addHook("onClose", () => {
      services.imageGenerations.stop();
    });
  }
  return app;
}
