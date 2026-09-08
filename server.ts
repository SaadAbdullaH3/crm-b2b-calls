/**
 * Custom Next.js server.
 *
 * We do NOT use `next start`. This app needs one long-lived Node process that
 * owns three things at once:
 *   1. the Next.js request handler
 *   2. the Socket.io server (realtime lead-lock / notification events)
 *   3. the node-cron jobs (5-minute auto-assign, idle sweep)
 *
 * This is also why the deployment target is a VPS behind Nginx with PM2/Docker
 * rather than Vercel — see docs/crm-b2b-build-plan.md, Part 2.
 *
 * Run with `npm run dev` (tsx) or `npm start` (tsx, NODE_ENV=production).
 */

import { createServer } from "node:http";
import next from "next";
import { initSocketServer } from "@/server/socket";
import { startCronJobs, stopCronJobs } from "@/server/cron";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = Number.parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  const httpServer = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[server] request failed:", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    });
  });

  // Socket.io must attach to this same HTTP server so it shares the port and
  // sits behind the same Nginx location block.
  initSocketServer(httpServer);

  startCronJobs();

  httpServer.listen(port, () => {
    console.log(
      `[server] ready on http://${hostname}:${port} (${dev ? "development" : process.env.NODE_ENV})`,
    );
  });

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received, shutting down`);
    stopCronJobs();
    httpServer.close(() => process.exit(0));
    // Don't let a hung connection block a redeploy.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
