import { createSignal } from "solid-js";
import { announceAuthRejected } from "../stores/auth";

export type WSMessage = {
  op: string;
  d: any;
};

type MessageHandler = (msg: WSMessage) => void;

let socket: WebSocket | null = null;
let handlers: MessageHandler[] = [];
let reconnectTimer: number | null = null;
let reconnectDelay = 1000;
let pingInterval: number | null = null;
let pingSentAt = 0;
let intentionalDisconnect = false;
let failedAttempts = 0;

export type ConnState = "connected" | "reconnecting" | "offline";
const [connState, setConnState] = createSignal<ConnState>("offline");
const [ping, setPing] = createSignal<number | null>(null);

export { connState, ping };

export function connectWS(token: string) {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  intentionalDisconnect = false;
  setConnState("reconnecting");

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${proto}//${location.host}/ws`);

  socket.onopen = () => {
    reconnectDelay = 1000;
    failedAttempts = 0;
    setConnState("connected");
    send("authenticate", { token });
    startPing();
  };

  socket.onmessage = (e) => {
    try {
      const msg: WSMessage = JSON.parse(e.data);
      if (msg.op === "pong") {
        if (pingSentAt > 0) setPing(Date.now() - pingSentAt);
        return;
      }
      handlers.forEach((h) => h(msg));
    } catch {}
  };

  socket.onclose = (e: CloseEvent) => {
    socket = null;
    stopPing();
    setPing(null);
    if (intentionalDisconnect) return;
    // 1008 (policy violation) is how the server rejects credentials: expired or
    // invalid token, deleted account, pending approval. Retrying would loop
    // forever, so hand the user back to the login screen instead.
    if (e.code === 1008) {
      intentionalDisconnect = true;
      setConnState("offline");
      announceAuthRejected(friendlyAuthReason(e.reason));
      return;
    }
    failedAttempts++;
    // After a few failed attempts show "Offline" instead of "Waiting"; keep retrying regardless.
    setConnState(failedAttempts >= 3 ? "offline" : "reconnecting");
    scheduleReconnect(token);
  };

  socket.onerror = () => {
    socket?.close();
  };
}

function friendlyAuthReason(reason: string): string {
  if (reason.includes("pending")) return "Your account is still waiting for approval.";
  if (reason.includes("token")) return "Your session has expired. Please sign in again.";
  return "You were signed out by the server. Please sign in again.";
}

function startPing() {
  stopPing();
  pingInterval = window.setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      pingSentAt = Date.now();
      send("ping", {});
    }
  }, 10000);
}

function stopPing() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function scheduleReconnect(token: string) {
  if (reconnectTimer) return;
  // Jitter spreads clients out after a server restart so they don't all reconnect in lockstep.
  const jitter = Math.random() * 0.4 * reconnectDelay;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connectWS(token);
  }, reconnectDelay + jitter);
}

export function disconnectWS() {
  intentionalDisconnect = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopPing();
  setConnState("offline");
  setPing(null);
  socket?.close();
  socket = null;
}

export function send(op: string, data: any) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ op, d: data }));
  }
}

export function onMessage(handler: MessageHandler): () => void {
  handlers.push(handler);
  return () => {
    handlers = handlers.filter((h) => h !== handler);
  };
}
