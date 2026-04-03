import { createSignal, Show } from "solid-js";
import type { Channel } from "../../stores/channels";
import { setChannelSettingsId } from "../../stores/channels";

interface ChannelItemProps {
  channel: Channel;
  selected: boolean;
  canManage: boolean;
  onClick: () => void;
}

export default function ChannelItem(props: ChannelItemProps) {
  const isRestricted = () => props.channel.visibility !== "public" && !props.channel.is_member;
  const icon = () => isRestricted() ? "\uD83D\uDD12" : (props.channel.type === "voice" ? "\u23E3" : "#");
  const [hovered, setHovered] = createSignal(false);

  return (
    <div style={{ position: "relative" }}>
      <div
        onClick={props.onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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
          color: isRestricted() ? "var(--text-muted)" : props.selected ? "var(--text-primary)" : "var(--text-secondary)",
          opacity: isRestricted() ? "0.7" : "1",
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
            color: isRestricted() ? "var(--text-muted)" : props.channel.type === "voice" ? "var(--success)" : "var(--accent)",
          }}
        >
          {icon()}
        </span>
        <span style={{ flex: "1", "min-width": "0", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
          {props.channel.name}
        </span>
        <Show when={props.canManage && hovered()}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setChannelSettingsId(props.channel.id);
            }}
            style={{
              "font-size": "11px",
              color: "var(--text-muted)",
              padding: "0 4px",
              "flex-shrink": "0",
              "line-height": "1",
            }}
          >
            [...]
          </button>
        </Show>
      </div>
    </div>
  );
}
