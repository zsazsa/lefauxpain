import { createSignal } from "solid-js";

export type Channel = {
  id: string;
  name: string;
  type: "voice" | "text";
  position: number;
};

const [channels, setChannels] = createSignal<Channel[]>([]);
const [selectedChannelId, setSelectedChannelId] = createSignal<string | null>(
  null
);

export { channels, selectedChannelId, setSelectedChannelId };

export function setChannelList(chs: Channel[]) {
  setChannels(chs.sort((a, b) => a.position - b.position));
}

export function addChannel(ch: Channel) {
  setChannels((prev) => [...prev, ch].sort((a, b) => a.position - b.position));
}

export function removeChannel(id: string) {
  setChannels((prev) => prev.filter((c) => c.id !== id));
  if (selectedChannelId() === id) {
    setSelectedChannelId(null);
  }
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
