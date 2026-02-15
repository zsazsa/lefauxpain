import { createSignal } from "solid-js";
import { isTauri } from "../lib/devices";

export type UpdateStatus = "idle" | "checking" | "no-update" | "available" | "downloading" | "ready" | "error";

const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>("idle");
const [updateVersion, setUpdateVersion] = createSignal("");
const [updateBody, setUpdateBody] = createSignal("");
const [updateProgress, setUpdateProgress] = createSignal(0);
const [updateError, setUpdateError] = createSignal("");
let pendingUpdate: any = null;

export { updateStatus, updateVersion, updateBody, updateProgress, updateError };

export async function checkForUpdates() {
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
    setUpdateError(e.message || "Failed to check for updates");
    setUpdateStatus("error");
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
  // Initial check after 30 seconds (let the app finish loading)
  setTimeout(() => {
    checkForUpdates();
  }, 30_000);
  // Then every 2 hours
  setInterval(() => {
    // Only re-check if we haven't already found an update or started downloading
    const s = updateStatus();
    if (s === "available" || s === "downloading" || s === "ready") return;
    checkForUpdates();
  }, TWO_HOURS);
}
