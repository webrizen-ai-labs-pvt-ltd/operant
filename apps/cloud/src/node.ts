import { getRequestListener } from "@hono/node-server";
import app from "./index.ts";

/** The same app as a plain Node.js handler, for the single-function bundle (scripts/build-vercel.mjs). */
export default getRequestListener(app.fetch);
