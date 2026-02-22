import { createSignal } from "solid-js";

export type UIMode = "standard" | "terminal";

const stored = localStorage.getItem("ui-mode");
const initial: UIMode = stored === "terminal" ? "terminal" : "standard";

const [uiMode, _setUIMode] = createSignal<UIMode>(initial);

export { uiMode };

export function setUIMode(mode: UIMode) {
  _setUIMode(mode);
  localStorage.setItem("ui-mode", mode);
}
