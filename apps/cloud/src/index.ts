import { createCloudApp } from "./app.ts";
import { loadEnv } from "./env.ts";

/** Production entry: the `cloud` service in vercel.json (Vercel's Hono preset serves the default export). */
const app = await createCloudApp(loadEnv());
export default app;
