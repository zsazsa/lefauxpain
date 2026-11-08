import { Show } from "solid-js";
import { isTauri } from "../lib/devices";
import {
  updateStatus,
  updateVersion,
  updateProgress,
  updateError,
  updateDismissed,
  downloadAndInstall,
  relaunchApp,
  checkForUpdates,
  dismissUpdateBanner,
  openReleasePage,
  isLinuxDesktop,
} from "../stores/updateChecker";

/**
 * Top-of-app prompt shown in the desktop shell when the updater reports a
 * newer release (spec: desktop-update-prompt). Driven by the same store as
 * the sidebar button and the Settings "App" tab; [LATER] only hides this
 * banner for the session.
 */
export default function DesktopUpdateBanner() {
  const visible = () => {
    if (!isTauri || updateDismissed()) return false;
    const s = updateStatus();
    if (s === "available" || s === "downloading" || s === "ready") return true;
    // A failed check with nothing found belongs in Settings, not up here.
    return s === "error" && updateVersion() !== "";
  };

  const btn = (color: string) => ({
    padding: "2px 10px",
    border: `1px solid ${color}`,
    color,
    "background-color": "transparent",
    cursor: "pointer",
    "font-size": "12px",
  });

  return (
    <Show when={visible()}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "flex-wrap": "wrap",
          gap: "12px",
          padding: "8px 16px",
          "background-color": "rgba(201,168,76,0.12)",
          "border-bottom": "1px solid rgba(201,168,76,0.35)",
          "font-size": "13px",
          color: "var(--accent)",
        }}
      >
        <Show when={updateStatus() === "available"}>
          <span>Desktop app {updateVersion()} is available.</span>
          <Show
            when={!isLinuxDesktop}
            fallback={
              <button onClick={() => openReleasePage()} style={btn("var(--accent)")}>
                [DOWNLOAD]
              </button>
            }
          >
            <button onClick={() => downloadAndInstall()} style={btn("var(--accent)")}>
              [DOWNLOAD &amp; UPDATE]
            </button>
          </Show>
          <button onClick={dismissUpdateBanner} style={btn("var(--text-muted)")}>
            [LATER]
          </button>
        </Show>

        <Show when={updateStatus() === "downloading"}>
          <span>
            Downloading desktop app {updateVersion()}… {Math.round(updateProgress() * 100)}%
          </span>
        </Show>

        <Show when={updateStatus() === "ready"}>
          <span>Desktop app {updateVersion()} installed.</span>
          <button onClick={() => relaunchApp()} style={btn("var(--accent)")}>
            [RESTART NOW]
          </button>
          <button onClick={dismissUpdateBanner} style={btn("var(--text-muted)")}>
            [LATER]
          </button>
        </Show>

        <Show when={updateStatus() === "error"}>
          <span style={{ color: "var(--danger)" }}>
            Update to {updateVersion()} failed: {updateError()}
          </span>
          <button onClick={() => checkForUpdates(true)} style={btn("var(--accent)")}>
            [RETRY]
          </button>
          <button onClick={() => openReleasePage()} style={btn("var(--accent)")}>
            [DOWNLOAD PAGE]
          </button>
          <button onClick={dismissUpdateBanner} style={btn("var(--text-muted)")}>
            [LATER]
          </button>
        </Show>
      </div>
    </Show>
  );
}
