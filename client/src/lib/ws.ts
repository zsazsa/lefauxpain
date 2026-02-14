import { createSignal } from "solid-js";

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

export type ConnState = "connected" | "reconnecting" | "offline";
const [connState, setConnState] = createSignal<ConnState>("offline");
const [ping, setPing] = createSignal<number | null>(null);

export { connState, ping };

export function connectWS(token: string) {
  if (socket?.readyState === WebSocket.OPEN) return;

  setConnState("reconnecting");

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${proto}//${location.host}/ws`);

  socket.onopen = () => {
    reconnectDelay = 1000;
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

  socket.onclose = () => {
    socket = null;
    stopPing();
    setPing(null);
    setConnState("reconnecting");
    scheduleReconnect(token);
  };

  socket.onerror = () => {
    socket?.close();
  };
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
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connectWS(token);
  }, reconnectDelay);
}

export function disconnectWS() {
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
