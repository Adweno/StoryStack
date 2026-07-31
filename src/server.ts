import { AppServer } from "./api/AppServer";
import { EnvFileLoader } from "./services/EnvFileLoader";

new EnvFileLoader().load();

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? "0.0.0.0";
const server = new AppServer();

server.app.listen(port, host, async () => {
  console.log(`Story Stack running at http://${host}:${port}`);

  const libraryPath = process.env.STORY_STACK_LIBRARY_PATH?.trim();
  if (libraryPath) {
    try {
      const result = await server.context.catalogSyncService.sync(libraryPath);
      console.log(`Story Stack synced ${result.scanned} books from ${libraryPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      console.error(`Story Stack could not sync ${libraryPath}: ${message}`);
    }
  }
});
