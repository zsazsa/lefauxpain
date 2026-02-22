import { channels, selectedChannelId } from "../../stores/channels";

interface TerminalTitleBarProps {
  onHelp: () => void;
}

export default function TerminalTitleBar(props: TerminalTitleBarProps) {
  const channel = () => {
    const id = selectedChannelId();
    if (!id) return null;
    return channels().find((c) => c.id === id);
  };

  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        padding: "6px 12px",
        "border-bottom": "1px solid var(--border-gold)",
        "background-color": "var(--bg-secondary)",
        "font-size": "13px",
        "min-height": "28px",
      }}
    >
      <span style={{ color: "var(--accent)", "font-weight": "600" }}>
        {channel() ? `# ${channel()!.name}` : "// select a channel"}
      </span>
      <button
        onClick={props.onHelp}
        style={{
          padding: "0 6px",
          "font-size": "12px",
          color: "var(--text-muted)",
          cursor: "pointer",
        }}
        title="Help"
      >
        [?]
      </button>
    </div>
  );
}
