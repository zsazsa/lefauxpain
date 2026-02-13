export type WSMessage = {
  op: string;
  d: any;
};

type MessageHandler = (msg: WSMessage) => void;

let socket: WebSocket | null = null;
let handlers: MessageHandler[] = [];
let reconnectTimer: number | null = null;
let reconnectDelay = 1000;

export function connectWS(token: string) {
  if (socket?.readyState === WebSocket.OPEN) return;

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${proto}//${location.host}/ws`);

  socket.onopen = () => {
    reconnectDelay = 1000;
    send("authenticate", { token });
  };

  socket.onmessage = (e) => {
    try {
      const msg: WSMessage = JSON.parse(e.data);
      handlers.forEach((h) => h(msg));
    } catch {}
  };

  socket.onclose = () => {
    socket = null;
    scheduleReconnect(token);
  };

  socket.onerror = () => {
    socket?.close();
  };
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
