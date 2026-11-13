import cors from "cors";
import express from "express";
import helmet from "helmet";
import { connectDb } from "./config/db";
import { env } from "./config/env";
import {
  errorHandler,
  notFoundHandler,
} from "./middlewares/error.middleware";
import routes from "./routes";

async function bootstrap() {
  await connectDb();

  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  // Generate quiz (nhiều chunk Gemini) có thể rất lâu
  const server = app.listen(env.port, () => {
    console.log(`[server] QuizPractice API listening on :${env.port}`);
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
