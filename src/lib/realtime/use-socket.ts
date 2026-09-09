"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * One shared Socket.io connection per browser tab.
 *
 * Module-level rather than per-component: the bell, the inbox and the open
 * thread all subscribe, and three components mounting must not open three
 * sockets. The handshake authenticates from the session cookie (Dev A's
 * socket.ts), so there is no token to pass here.
 */

let socket: Socket | null = null;
let refCount = 0;

function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: "/api/socket", withCredentials: true });
  }
  return socket;
}

/**
 * Subscribes to one event for the lifetime of the component.
 *
 * `handler` is kept in a ref so a caller passing an inline arrow function
 * doesn't detach and reattach the listener on every render.
 */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const s = getSocket();
    refCount++;

    const listener = (payload: T) => handlerRef.current(payload);
    s.on(event, listener);

    return () => {
      s.off(event, listener);
      refCount--;
      // Last subscriber leaves -> close, so a signed-out tab isn't holding a
      // live socket open.
      if (refCount === 0) {
        s.disconnect();
        socket = null;
      }
    };
  }, [event]);
}
