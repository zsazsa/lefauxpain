import { createSignal, Show } from "solid-js";
import { send } from "../../lib/ws";

export default function CreateChannel() {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal("");
  const [type, setType] = createSignal<"text" | "voice">("text");

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const n = name().trim();
    if (!n) return;
    send("create_channel", { name: n, type: type() });
    setName("");
    setOpen(false);
  };

  return (
    <div style={{ padding: "8px 16px", "margin-top": "8px" }}>
      <Show
        when={open()}
        fallback={
          <button
            onClick={() => setOpen(true)}
            style={{
              width: "100%",
              padding: "4px",
              "font-size": "12px",
              color: "var(--text-muted)",
              "text-align": "left",
            }}
          >
            [+ create channel]
          </button>
        }
      >
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", "flex-direction": "column", gap: "6px" }}
        >
          <input
            type="text"
            placeholder="channel name"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            maxLength={32}
            style={{
              padding: "4px 8px",
              "background-color": "var(--bg-primary)",
              border: "1px solid var(--border-gold)",
              "font-size": "12px",
              color: "var(--text-primary)",
            }}
          />
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              type="button"
              onClick={() => setType("text")}
              style={{
                flex: "1",
                padding: "3px",
                "font-size": "11px",
                border: type() === "text"
                  ? "1px solid var(--accent)"
                  : "1px solid var(--border-gold)",
                "background-color":
                  type() === "text" ? "var(--accent-glow)" : "transparent",
                color: type() === "text" ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              # text
            </button>
            <button
              type="button"
              onClick={() => setType("voice")}
              style={{
                flex: "1",
                padding: "3px",
                "font-size": "11px",
                border: type() === "voice"
                  ? "1px solid var(--accent)"
                  : "1px solid var(--border-gold)",
                "background-color":
                  type() === "voice" ? "var(--accent-glow)" : "transparent",
                color: type() === "voice" ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              {"\u2666"} voice
            </button>
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              type="submit"
              style={{
                flex: "1",
                padding: "3px 8px",
                "font-size": "11px",
                "background-color": "var(--accent)",
                color: "var(--bg-primary)",
                "font-weight": "600",
              }}
            >
              [create]
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: "3px 8px",
                "font-size": "11px",
                color: "var(--text-muted)",
              }}
            >
              [cancel]
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
