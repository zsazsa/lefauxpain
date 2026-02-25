import { settings } from "../stores/settings";

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !window.Notification) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (getNotificationPermission() === "unsupported") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function showMentionNotification(
  author: string,
  channel: string,
  preview: string,
  notificationId?: string,
): void {
  if (!settings().browserNotifications) return;
  if (getNotificationPermission() !== "granted") return;
  if (document.hasFocus()) return;

  const title = `@${author} in #${channel}`;
  const tag = notificationId ? `mention-${notificationId}` : undefined;
  const n = new Notification(title, { body: preview, tag });

  n.onclick = () => {
    window.focus();
    n.close();
  };

  setTimeout(() => n.close(), 5000);
}
