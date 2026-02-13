import { channels } from "../../stores/channels";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";

interface TextChannelProps {
  channelId: string;
}

export default function TextChannel(props: TextChannelProps) {
  const channel = () => channels().find((c) => c.id === props.channelId);

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
      }}
    >
      {/* Channel header */}
      <div
        style={{
          padding: "12px 16px",
          "border-bottom": "1px solid var(--bg-primary)",
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "font-weight": "600",
        }}
      >
        <span style={{ color: "var(--text-muted)", "font-size": "20px" }}>#</span>
        <span>{channel()?.name}</span>
      </div>

      {/* Messages */}
      <MessageList channelId={props.channelId} />

      {/* Input */}
      <MessageInput channelId={props.channelId} channelName={channel()?.name || ""} />
    </div>
  );
}
