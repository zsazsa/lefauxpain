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
        padding: "6px 16px",
        cursor: "pointer",
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "border-radius": "4px",
        margin: "1px 8px",
        "background-color": props.selected
          ? "var(--bg-tertiary)"
          : "transparent",
        color: props.selected ? "var(--text-primary)" : "var(--text-secondary)",
        "font-size": "14px",
      }}
      onMouseOver={(e) => {
        if (!props.selected)
          e.currentTarget.style.backgroundColor = "rgba(100,80,140,0.3)";
      }}
      onMouseOut={(e) => {
        if (!props.selected)
          e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <span
        style={{
          "font-size": props.channel.type === "text" ? "18px" : "14px",
          "min-width": "20px",
          "text-align": "center",
          opacity: "0.7",
        }}
      >
        {icon()}
      </span>
      <span>{props.channel.name}</span>
    </div>
  );
}
