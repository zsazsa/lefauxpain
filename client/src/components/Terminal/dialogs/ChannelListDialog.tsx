import { createSignal, For, onMount, onCleanup } from "solid-js";
import { channels, setSelectedChannelId, selectedChannelId } from "../../../stores/channels";
import TerminalDialog from "../TerminalDialog";

interface ChannelListDialogProps {
  onClose: () => void;
}

export default function ChannelListDialog(props: ChannelListDialogProps) {
  const textChannels = () => channels().filter((c) => c.type === "text");
  const [selectedIdx, setSelectedIdx] = createSignal(0);

  onMount(() => {
    const idx = textChannels().findIndex((c) => c.id === selectedChannelId());
    if (idx >= 0) setSelectedIdx(idx);
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const list = textChannels();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIdx((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const ch = list[selectedIdx()];
      if (ch) {
        setSelectedChannelId(ch.id);
        props.onClose();
      }
    }
  };

  onMount(() => document.addEventListener("keydown", handleKeyDown, true));
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown, true));

  return (
    <TerminalDialog title="CHANNELS" onClose={props.onClose}>
      <For each={textChannels()}>
        {(ch, i) => (
          <div
            onClick={() => {
              setSelectedChannelId(ch.id);
              props.onClose();
            }}
            onMouseOver={() => setSelectedIdx(i())}
            style={{
              padding: "4px 8px",
              cursor: "pointer",
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              "background-color": i() === selectedIdx()
                ? "var(--accent-glow)"
                : "transparent",
              "font-size": "13px",
              color: ch.id === selectedChannelId()
                ? "var(--accent)"
                : "var(--text-secondary)",
            }}
          >
            <span>
              <span style={{ color: "var(--text-muted)" }}>#</span> {ch.name}
            </span>
          </div>
        )}
      </For>
    </TerminalDialog>
  );
}
