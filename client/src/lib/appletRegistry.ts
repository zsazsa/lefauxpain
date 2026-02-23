type ReadyHandler = (data: any) => void;
type EventHandler = (data: any) => void;

const readyHandlers: ReadyHandler[] = [];
const eventHandlers: Map<string, EventHandler> = new Map();

export function registerReadyHandler(fn: ReadyHandler) {
  readyHandlers.push(fn);
}

export function registerEventHandler(op: string, fn: EventHandler) {
  eventHandlers.set(op, fn);
}

export function dispatchReady(data: any) {
  for (const fn of readyHandlers) fn(data);
}

export function dispatchEvent(op: string, data: any): boolean {
  const handler = eventHandlers.get(op);
  if (handler) {
    handler(data);
    return true;
  }
  return false;
}
