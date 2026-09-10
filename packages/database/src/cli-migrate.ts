import { resolveDatabasePath } from "./paths.js";
import { DatabaseManager } from "./database-manager.js";

const manager = new DatabaseManager(resolveDatabasePath());
await manager.open();
manager.close();
console.log(`Database migrations applied: ${manager.databasePath}`);
