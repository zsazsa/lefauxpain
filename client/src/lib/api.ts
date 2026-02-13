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
