/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import "./styles/global.css";

// Desktop app detection: the Tauri server selector passes ?tauri=1 when
// navigating here. Persist to localStorage (on this origin) so it survives
// reloads, then clean up the URL.
const _params = new URLSearchParams(window.location.search);
if (_params.has("tauri")) {
  localStorage.setItem("lefauxpain_desktop", "1");
  _params.delete("tauri");
  const qs = _params.toString();
  window.history.replaceState({}, "", window.location.pathname + (qs ? "?" + qs : ""));
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

render(() => <App />, root);
