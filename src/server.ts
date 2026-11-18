import { createApp } from "./app";
import { connectDb } from "./config/db";
import { env } from "./config/env";
import { loadRuntimeFromDb } from "./services/admin.service";

async function bootstrap() {
  await connectDb();
  await loadRuntimeFromDb();
  console.log("[server] App settings loaded (DB override nếu có)");

  const app = createApp();

  // Generate quiz (nhiều chunk Gemini) có thể rất lâu
  const server = app.listen(env.port, () => {
    console.log(`[server] Mỹ Miều Quiz API listening on :${env.port}`);
  });
  const thirtyMin = 30 * 60_000;
  server.timeout = thirtyMin;
  server.headersTimeout = thirtyMin + 10_000;
  server.requestTimeout = thirtyMin;
  server.keepAliveTimeout = 120_000;
}

bootstrap().catch((err) => {
  console.error("[server] Failed to start:", err);
  process.exit(1);
});
