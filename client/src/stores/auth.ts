import { createSignal } from "solid-js";

export type User = {
  id: string;
  username: string;
  avatar_url: string | null;
  email?: string | null;
  is_admin: boolean;
  has_password?: boolean;
};

const [currentUser, setCurrentUser] = createSignal<User | null>(null);
// Message shown on the login screen after the server rejected the session
// (expired token, deleted account, pending approval).
const [authNotice, setAuthNotice] = createSignal<string | null>(null);
export { authNotice, setAuthNotice };

export const AUTH_REJECTED_EVENT = "lfp:auth-rejected";

/** Fired by the transport layers when the server says our credentials are no good. */
export function announceAuthRejected(reason: string) {
  window.dispatchEvent(new CustomEvent(AUTH_REJECTED_EVENT, { detail: reason }));
}
const [token, setToken] = createSignal<string | null>(
  localStorage.getItem("token")
);

export { currentUser, token };

export function login(user: User, t: string) {
  setAuthNotice(null);
  localStorage.setItem("token", t);
  localStorage.setItem("username", user.username);
  setToken(t);
  setCurrentUser(user);
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("username");
  setToken(null);
  setCurrentUser(null);
}

export function setUser(user: User) {
  setCurrentUser(user);
}
