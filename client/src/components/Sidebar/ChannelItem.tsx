import type { Channel } from "../../stores/channels";

interface ChannelItemProps {
  channel: Channel;
  selected: boolean;
  onClick: () => void;
}

export default function ChannelItem(props: ChannelItemProps) {
  const icon = () => (props.channel.type === "voice" ? "\u{1F50A}" : "#");

  return (
    <div
      onClick={props.onClick}
      style={{
        padding: "4px 16px",
        cursor: "pointer",
        display: "flex",
        "align-items": "center",
        gap: "8px",
        margin: "1px 8px",
        "border-left": props.selected
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        "background-color": props.selected
          ? "var(--accent-glow)"
          : "transparent",
        color: props.selected ? "var(--text-primary)" : "var(--text-secondary)",
        "font-size": "13px",
      }}
      onMouseOver={(e) => {
        if (!props.selected)
          e.currentTarget.style.backgroundColor = "var(--accent-glow)";
      }}
      onMouseOut={(e) => {
        if (!props.selected)
          e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <span
        style={{
          "font-size": props.channel.type === "text" ? "16px" : "14px",
          "min-width": "16px",
          "text-align": "center",
          color: "var(--accent)",
        }}
      >
        {icon()}
      </span>
      <span>{props.channel.name}</span>
    </div>
  );
}
