import type { Server as HttpServer } from "node:http";
import { Server as IOServer, type Socket } from "socket.io";
import { EVENTS, ROOM } from "@/lib/realtime/events";
import { resolveSessionFromToken, SESSION_COOKIE } from "@/lib/auth/session-core";

/**
 * One Socket.io namespace attached to the same HTTP server Next.js runs on.
 *
 * Path is /api/socket so Nginx can proxy a single location block in production
 * without colliding with Next's own /_next/webpack-hmr socket.
 */

let io: IOServer | null = null;

export const SOCKET_PATH = "/api/socket";

interface SocketData {
  userId: string;
  sessionId: string;
  roleName: string;
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function initSocketServer(httpServer: HttpServer): IOServer {
  if (io) return io;

  io = new IOServer(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    cors: { origin: false },
  });

  // Authenticate on the handshake using the same session cookie the HTTP side
  // uses. An unauthenticated socket never joins a room and never receives an
  // event — the socket layer is not a way around RBAC.
  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
      if (!token) return next(new Error("UNAUTHENTICATED"));

      const session = await resolveSessionFromToken(token);
      if (!session) return next(new Error("UNAUTHENTICATED"));

      (socket.data as SocketData) = {
        userId: session.userId,
        sessionId: session.sessionId,
        roleName: session.roleName,
      };
      return next();
    } catch {
      return next(new Error("SOCKET_AUTH_FAILED"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const { userId, roleName } = socket.data as SocketData;
    socket.join(ROOM.user(userId));
    socket.join(ROOM.role(roleName));

    if (process.env.NODE_ENV !== "production") {
      console.log(`[socket] connected user=${userId} role=${roleName}`);
    }

    socket.on("disconnect", (reason) => {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[socket] disconnected user=${userId} (${reason})`);
      }
    });
  });

  console.log(`[socket] Socket.io attached at ${SOCKET_PATH}`);
  return io;
}

/**
 * Access the running Socket.io server from an API route.
 * Returns null when called outside the custom server (e.g. during `next build`),
 * so callers should treat emitting as best-effort and never block a DB write on it.
 */
export function getIO(): IOServer | null {
  return io;
}

/** Emit to every socket belonging to one user. */
export function emitToUser(userId: string, event: string, payload: unknown) {
  getIO()?.to(ROOM.user(userId)).emit(event, payload);
}

/** Emit to everyone holding a role (e.g. all of management). */
export function emitToRole(roleName: string, event: string, payload: unknown) {
  getIO()?.to(ROOM.role(roleName)).emit(event, payload);
}

export { EVENTS, ROOM };
