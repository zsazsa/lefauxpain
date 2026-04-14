import { onMount, onCleanup } from "solid-js";
import { send } from "../../lib/ws";

const EMOJI_LIST = [
  "👍", "👎", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀", "🙏",
  "💯", "✅", "❌", "🤔", "👏", "🚀", "💪", "😍", "🙌", "⭐",
];

interface EmojiPickerProps {
  messageId: string;
  onClose: () => void;
}

export default function EmojiPicker(props: EmojiPickerProps) {
  let ref: HTMLDivElement | undefined;

  const handleClickOutside = (e: MouseEvent) => {
    if (ref && !ref.contains(e.target as Node)) {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
  });

  const handlePick = (emoji: string) => {
    send("add_reaction", { message_id: props.messageId, emoji });
    props.onClose();
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        bottom: "100%",
        right: "0",
        "padding-bottom": "4px",
        "z-index": "20",
      }}
    >
      <div style={{
        "background-color": "var(--bg-secondary)",
        border: "1px solid var(--border-gold)",
        padding: "6px",
        display: "grid",
        "grid-template-columns": "repeat(5, 1fr)",
        gap: "2px",
        "box-shadow": "0 2px 8px rgba(0,0,0,0.4)",
      }}>
      {EMOJI_LIST.map((emoji) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handlePick(emoji);
          }}
          style={{
            padding: "4px",
            "font-size": "16px",
            "line-height": "1",
            background: "none",
            border: "none",
            cursor: "pointer",
            "border-radius": "2px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          {emoji}
        </button>
      ))}
      </div>
    </div>
  );
}
