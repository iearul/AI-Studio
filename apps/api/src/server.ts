import { buildApp } from "./app.js";
import { getApiConfig } from "./config.js";
import { createServices } from "./services.js";

const config = getApiConfig();
const services = await createServices();
const app = await buildApp(config, services);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  services.database.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  services.database.close();
  process.exit(1);
}
