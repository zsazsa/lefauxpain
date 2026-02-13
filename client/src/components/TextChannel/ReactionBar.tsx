import { For } from "solid-js";
import type { Message } from "../../stores/messages";
import { currentUser } from "../../stores/auth";
import { send } from "../../lib/ws";

interface ReactionBarProps {
  message: Message;
}

export default function ReactionBar(props: ReactionBarProps) {
  const toggleReaction = (emoji: string) => {
    const user = currentUser();
    if (!user) return;

    const group = props.message.reactions.find((r) => r.emoji === emoji);
    if (group?.user_ids.includes(user.id)) {
      send("remove_reaction", { message_id: props.message.id, emoji });
    } else {
      send("add_reaction", { message_id: props.message.id, emoji });
    }
  };

  return (
    <span style={{ display: "inline-flex", gap: "4px", "vertical-align": "baseline" }}>
      <For each={props.message.reactions}>
        {(reaction) => {
          const isActive = () =>
            currentUser()
              ? reaction.user_ids.includes(currentUser()!.id)
              : false;

          return (
            <button
              onClick={(e) => { e.stopPropagation(); toggleReaction(reaction.emoji); }}
              style={{
                display: "inline-flex",
                "align-items": "center",
                gap: "2px",
                padding: "0 4px",
                "font-size": "12px",
                "background-color": isActive()
                  ? "var(--mention-bg)"
                  : "transparent",
                border: isActive()
                  ? "1px solid var(--cyan)"
                  : "1px solid var(--border-gold)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                "line-height": "1.4",
              }}
            >
              <span>{reaction.emoji}</span>
              <span style={{ "font-size": "11px" }}>{reaction.count}</span>
            </button>
          );
        }}
      </For>
    </span>
  );
}
