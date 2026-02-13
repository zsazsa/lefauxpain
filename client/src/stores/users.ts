import { createSignal } from "solid-js";
import type { User } from "./auth";

const [onlineUsers, setOnlineUsers] = createSignal<User[]>([]);

export { onlineUsers };

export function setOnlineUserList(users: User[]) {
  setOnlineUsers(users);
}

export function addOnlineUser(user: User) {
  setOnlineUsers((prev) => {
    if (prev.find((u) => u.id === user.id)) return prev;
    return [...prev, user];
  });
}

export function removeOnlineUser(userId: string) {
  setOnlineUsers((prev) => prev.filter((u) => u.id !== userId));
}

export function getUsernameById(userId: string): string {
  const user = onlineUsers().find((u) => u.id === userId);
  return user?.username || "Unknown";
}
