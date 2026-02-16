import { createSignal } from "solid-js";
import { isTauri } from "../lib/devices";

export type UpdateStatus = "idle" | "checking" | "no-update" | "available" | "downloading" | "ready" | "error";

const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>("idle");
const [updateVersion, setUpdateVersion] = createSignal("");
const [updateBody, setUpdateBody] = createSignal("");
const [updateProgress, setUpdateProgress] = createSignal(0);
const [updateError, setUpdateError] = createSignal("");
let pendingUpdate: any = null;

const [appVersion, setAppVersion] = createSignal("");

export { updateStatus, updateVersion, updateBody, updateProgress, updateError, appVersion };

// Fetch the app version from the Tauri binary
if (isTauri) {
  import("@tauri-apps/api/app").then(({ getVersion }) => {
    getVersion().then(setAppVersion).catch(() => {});
  }).catch(() => {});
}

export async function checkForUpdates(manual = false) {
  setUpdateStatus("checking");
  setUpdateError("");
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      pendingUpdate = update;
      setUpdateVersion(update.version);
      setUpdateBody(update.body || "");
      setUpdateStatus("available");
    } else {
      setUpdateStatus("no-update");
    }
  } catch (e: any) {
    if (manual) {
      // Only show error when user explicitly clicked the button
      setUpdateError(e.message || "Failed to check for updates");
      setUpdateStatus("error");
    } else {
      // Background check failed (likely no internet) — stay idle, retry next cycle
      console.log("[updater] background check failed:", e.message);
      setUpdateStatus("idle");
    }
  }
}

export async function downloadAndInstall() {
  if (!pendingUpdate) return;
  setUpdateStatus("downloading");
  setUpdateProgress(0);
  try {
    let totalLen = 0;
    let downloaded = 0;
    await pendingUpdate.downloadAndInstall((event: any) => {
      if (event.event === "Started" && event.data?.contentLength) {
        totalLen = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (totalLen > 0) setUpdateProgress(downloaded / totalLen);
      } else if (event.event === "Finished") {
        setUpdateProgress(1);
      }
    });
    setUpdateStatus("ready");
  } catch (e: any) {
    setUpdateError(e.message || "Download failed");
    setUpdateStatus("error");
  }
}

export async function relaunchApp() {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

const TWO_HOURS = 2 * 60 * 60 * 1000;

export function startUpdateChecker() {
  if (!isTauri) return;
  // Initial check after 5 seconds
  setTimeout(() => {
    checkForUpdates();
  }, 5_000);
  // Then every 2 hours
  setInterval(() => {
    // Only re-check if we haven't already found an update or started downloading
    const s = updateStatus();
    if (s === "available" || s === "downloading" || s === "ready") return;
    checkForUpdates();
  }, TWO_HOURS);
}
