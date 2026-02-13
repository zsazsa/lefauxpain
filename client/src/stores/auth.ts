import { createSignal } from "solid-js";

export type User = {
  id: string;
  username: string;
  avatar_url: string | null;
};

const [currentUser, setCurrentUser] = createSignal<User | null>(null);
const [token, setToken] = createSignal<string | null>(
  localStorage.getItem("token")
);

export { currentUser, token };

export function login(user: User, t: string) {
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
