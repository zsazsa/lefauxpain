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
              padding: "6px",
              "font-size": "13px",
              color: "var(--text-muted)",
              "border-radius": "4px",
              "text-align": "left",
            }}
            onMouseOver={(e) =>
              (e.currentTarget.style.color = "var(--text-primary)")
            }
            onMouseOut={(e) =>
              (e.currentTarget.style.color = "var(--text-muted)")
            }
          >
            + Create Channel
          </button>
        }
      >
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", "flex-direction": "column", gap: "6px" }}
        >
          <input
            type="text"
            placeholder="Channel name"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            maxLength={32}
            style={{
              padding: "6px 8px",
              "background-color": "var(--bg-primary)",
              "border-radius": "4px",
              "font-size": "13px",
              color: "var(--text-primary)",
            }}
          />
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              type="button"
              onClick={() => setType("text")}
              style={{
                flex: "1",
                padding: "4px",
                "font-size": "12px",
                "border-radius": "3px",
                "background-color":
                  type() === "text" ? "var(--accent)" : "var(--bg-tertiary)",
                color: "white",
              }}
            >
              # Text
            </button>
            <button
              type="button"
              onClick={() => setType("voice")}
              style={{
                flex: "1",
                padding: "4px",
                "font-size": "12px",
                "border-radius": "3px",
                "background-color":
                  type() === "voice" ? "var(--accent)" : "var(--bg-tertiary)",
                color: "white",
              }}
            >
              Voice
            </button>
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              type="submit"
              style={{
                flex: "1",
                padding: "4px 8px",
                "font-size": "12px",
                "background-color": "var(--accent)",
                color: "white",
                "border-radius": "3px",
              }}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: "4px 8px",
                "font-size": "12px",
                color: "var(--text-muted)",
                "border-radius": "3px",
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
