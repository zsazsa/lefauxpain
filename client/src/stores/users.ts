import { createSignal } from "solid-js";
import type { User } from "./auth";

const [onlineUsers, setOnlineUsers] = createSignal<User[]>([]);
const [allUsers, setAllUsers] = createSignal<User[]>([]);

// Accumulates every user we've ever seen — never shrinks.
// Used for mention rendering so offline users still resolve.
const [knownUsers, setKnownUsers] = createSignal<Map<string, User>>(new Map());

export { onlineUsers, allUsers, knownUsers };

export function setOnlineUserList(users: User[]) {
  setOnlineUsers(users);
  mergeKnownUsers(users);
}

export function setAllUserList(users: User[]) {
  setAllUsers(users);
  mergeKnownUsers(users);
}

export function addOnlineUser(user: User) {
  setOnlineUsers((prev) => {
    if (prev.find((u) => u.id === user.id)) return prev;
    return [...prev, user];
  });
  mergeKnownUsers([user]);
}

export function removeOnlineUser(userId: string) {
  setOnlineUsers((prev) => prev.filter((u) => u.id !== userId));
  // intentionally NOT removed from knownUsers
}

export function mergeKnownUsers(users: Array<{ id: string; username: string }>) {
  setKnownUsers((prev) => {
    const next = new Map(prev);
    let changed = false;
    for (const u of users) {
      if (!next.has(u.id)) {
        next.set(u.id, { id: u.id, username: u.username, avatar_url: null, is_admin: false });
        changed = true;
      }
    }
    return changed ? next : prev;
  });
}

export function lookupUsername(userId: string): string | null {
  return knownUsers().get(userId)?.username ?? null;
}

export function getUsernameById(userId: string): string {
  const user = onlineUsers().find((u) => u.id === userId);
  return user?.username || "Unknown";
}
