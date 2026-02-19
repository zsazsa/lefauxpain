import { computePeaksFromFile, serializePeaks } from "./waveform";

const BASE = "/api/v1";

function getToken(): string {
  return localStorage.getItem("token") || "";
}

async function request(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (!(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "request failed" }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function getChannels() {
  return request("/channels");
}

export function getMessages(channelId: string, before?: string) {
  const params = new URLSearchParams({ limit: "50" });
  if (before) params.set("before", before);
  return request(`/channels/${channelId}/messages?${params}`);
}

export function getMessagesAround(channelId: string, messageId: string) {
  const params = new URLSearchParams({ limit: "50", around: messageId });
  return request(`/channels/${channelId}/messages?${params}`);
}

export function getAudioDevices(): Promise<{
  inputs: { id: string; name: string; default: boolean }[];
  outputs: { id: string; name: string; default: boolean }[];
}> {
  return request("/audio/devices");
}

export function setAudioDevice(id: string, kind: "input" | "output") {
  return request("/audio/device", {
    method: "POST",
    body: JSON.stringify({ id, kind }),
  });
}

export function getUsers(): Promise<
  {
    id: string;
    username: string;
    avatar_url: string | null;
    is_admin: boolean;
    created_at: string;
  }[]
> {
  return request("/admin/users");
}

export function deleteUser(id: string) {
  return request(`/admin/users/${id}`, { method: "DELETE" });
}

export function approveUser(id: string) {
  return request(`/admin/users/${id}/approve`, { method: "POST" });
}

export function setUserAdmin(id: string, isAdmin: boolean) {
  return request(`/admin/users/${id}/admin`, {
    method: "POST",
    body: JSON.stringify({ is_admin: isAdmin }),
  });
}

export function setUserPassword(id: string, password: string) {
  return request(`/admin/users/${id}/password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request("/auth/password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

export async function uploadFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  const token = getToken();
  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "upload failed" }));
    throw new Error(data.error);
  }
  return res.json();
}

export async function uploadMedia(file: File) {
  const form = new FormData();
  form.append("file", file);
  const token = getToken();
  const res = await fetch(`${BASE}/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "upload failed" }));
    throw new Error(data.error);
  }
  return res.json();
}

export async function deleteMedia(id: string) {
  return request(`/media/${id}`, { method: "DELETE" });
}

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.addEventListener("loadedmetadata", () => {
      const dur = isFinite(audio.duration) ? audio.duration : 0;
      URL.revokeObjectURL(url);
      resolve(dur);
    });
    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      resolve(0);
    });
    audio.src = url;
  });
}

export async function uploadRadioTrack(
  playlistId: string,
  file: File,
  onStatus?: (phase: "processing" | "uploading") => void,
) {
  onStatus?.("processing");
  const [duration, peaks] = await Promise.all([
    getAudioDuration(file),
    computePeaksFromFile(file).catch(() => null),
  ]);
  onStatus?.("uploading");
  const form = new FormData();
  form.append("file", file);
  form.append("duration", duration.toString());
  if (peaks) {
    form.append("waveform", serializePeaks(peaks));
  }
  const token = getToken();
  const res = await fetch(`${BASE}/radio/playlists/${playlistId}/tracks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "upload failed" }));
    throw new Error(data.error);
  }
  return res.json();
}

export async function deleteRadioTrack(trackId: string) {
  return request(`/radio/tracks/${trackId}`, { method: "DELETE" });
}

export function getEmailSettings(): Promise<{
  is_configured: boolean;
  email_verification_enabled: boolean;
  provider?: string;
  from_email?: string;
  from_name?: string;
  api_key_masked?: string;
  host?: string;
  port?: number;
  username?: string;
  password_masked?: string;
  encryption?: string;
}> {
  return request("/admin/settings/email");
}

export function saveEmailSettings(payload: {
  email_verification_enabled?: boolean;
  email_provider_config?: Record<string, unknown>;
}) {
  return request("/admin/settings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function sendTestEmail(): Promise<{ status: string; email: string }> {
  return request("/admin/settings/email/test", { method: "POST" });
}
