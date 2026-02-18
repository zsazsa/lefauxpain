import { createSignal } from "solid-js";

export type Notification = {
  id: string;
  type: string;
  data: Record<string, any>;
  read: boolean;
  created_at: string;
};

const [notifications, setNotifications] = createSignal<Notification[]>([]);

export { notifications };

export function unreadCount(): number {
  return notifications().filter((n) => !n.read).length;
}

export function setNotificationList(list: Notification[]) {
  setNotifications(list);
}

export function addNotification(n: Notification) {
  setNotifications((prev) => [n, ...prev]);
}

export function markRead(id: string) {
  setNotifications((prev) =>
    prev.map((n) => (n.id === id ? { ...n, read: true } : n))
  );
}

export function markAllRead() {
  setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
}
