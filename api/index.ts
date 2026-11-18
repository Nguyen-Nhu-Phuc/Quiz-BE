import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createApp } from "../src/app";
import { connectDb } from "../src/config/db";
import { loadRuntimeFromDb } from "../src/services/admin.service";

const app = createApp();

let ready: Promise<void> | null = null;

function ensureReady() {
  if (!ready) {
    ready = (async () => {
      await connectDb();
      await loadRuntimeFromDb();
    })();
  }
  return ready;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureReady();
  // Express 5 app as Node request listener
  return app(req as never, res as never);
}
