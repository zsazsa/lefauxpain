import { openThread } from "../../stores/messages";

interface ThreadSummary {
  reply_count: number;
  last_reply_at: string;
  last_reply_author: string;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function ThreadIndicator(props: { threadId: string; summary: ThreadSummary }) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        openThread(props.threadId);
      }}
      style={{
        display: "flex",
        "align-items": "center",
        "font-size": "11px",
        color: "var(--cyan)",
        cursor: "pointer",
        "padding-left": "60px",
        "margin-top": "-2px",
        "margin-bottom": "2px",
      }}
    >
      <span style={{ color: "var(--border-gold)", "margin-right": "6px" }}>{"\u2500\u2500"}</span>
      <span style={{ "margin-right": "4px" }}>
        {props.summary.reply_count} {props.summary.reply_count === 1 ? "reply" : "replies"}
      </span>
      <span style={{ color: "var(--text-muted)" }}>
        · last {formatRelativeTime(props.summary.last_reply_at)}
      </span>
    </div>
  );
}
