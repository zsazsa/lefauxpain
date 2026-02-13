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
    <div
      style={{
        display: "flex",
        "flex-wrap": "wrap",
        gap: "4px",
        "margin-top": "4px",
      }}
    >
      <For each={props.message.reactions}>
        {(reaction) => {
          const isActive = () =>
            currentUser()
              ? reaction.user_ids.includes(currentUser()!.id)
              : false;

          return (
            <button
              onClick={() => toggleReaction(reaction.emoji)}
              style={{
                display: "flex",
                "align-items": "center",
                gap: "4px",
                padding: "2px 6px",
                "border-radius": "4px",
                "font-size": "13px",
                "background-color": isActive()
                  ? "var(--mention-bg)"
                  : "var(--bg-tertiary)",
                border: isActive()
                  ? "1px solid var(--accent)"
                  : "1px solid transparent",
                color: "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              <span>{reaction.emoji}</span>
              <span style={{ "font-size": "12px" }}>{reaction.count}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
