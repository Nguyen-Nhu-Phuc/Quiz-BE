import mongoose from "mongoose";
import { env } from "./env";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global.__mongooseCache ?? {
  conn: null,
  promise: null,
};
global.__mongooseCache = cache;

export async function connectDb(): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);

  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose.connect(env.mongoUri).then((m) => {
      console.log("[db] Connected to MongoDB");
      return m;
    });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}
