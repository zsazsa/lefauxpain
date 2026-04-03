import { createSignal } from "solid-js";

export type Channel = {
  id: string;
  name: string;
  type: "voice" | "text";
  position: number;
  visibility: "public" | "visible" | "invisible";
  description: string | null;
  is_member: boolean;
  role: string | null;
  manager_ids: string[];
};

const [channels, setChannels] = createSignal<Channel[]>([]);
const [selectedChannelId, _setSelectedChannelId] = createSignal<string | null>(
  localStorage.getItem("selectedChannelId")
);
const [deletedChannels, setDeletedChannels] = createSignal<Channel[]>([]);

function setSelectedChannelId(id: string | null) {
  _setSelectedChannelId(id);
  if (id) {
    localStorage.setItem("selectedChannelId", id);
  } else {
    localStorage.removeItem("selectedChannelId");
  }
}

const [channelSettingsId, setChannelSettingsId] = createSignal<string | null>(null);

export { channels, selectedChannelId, setSelectedChannelId, deletedChannels, setDeletedChannels, channelSettingsId, setChannelSettingsId };

export function setChannelList(chs: Channel[]) {
  setChannels(chs.sort((a, b) => a.position - b.position));
}

export function addChannel(ch: Channel) {
  // Also remove from deleted list if restoring
  setDeletedChannels((prev) => prev.filter((c) => c.id !== ch.id));
  setChannels((prev) => [...prev.filter((c) => c.id !== ch.id), ch].sort((a, b) => a.position - b.position));
}

export function removeChannel(id: string) {
  setChannels((prev) => prev.filter((c) => c.id !== id));
  if (selectedChannelId() === id) {
    setSelectedChannelId(null);
  }
}

export function updateChannel(ch: Channel) {
  setChannels((prev) =>
    prev.map((c) => (c.id === ch.id ? { ...c, ...ch } : c))
  );
}

export function reorderChannelList(ids: string[]) {
  setChannels((prev) => {
    const map = new Map(prev.map((c) => [c.id, c]));
    return ids
      .map((id, i) => {
        const ch = map.get(id);
        return ch ? { ...ch, position: i } : null;
      })
      .filter(Boolean) as Channel[];
  });
}

export function selectedChannel(): Channel | undefined {
  const id = selectedChannelId();
  return id ? channels().find((c) => c.id === id) : undefined;
}
