import { createSignal } from "solid-js";

const isDesktop =
  localStorage.getItem("lefauxpain_desktop") === "1" ||
  !!(window as any).__DESKTOP__ ||
  !!(window as any).__TAURI_INTERNALS__;

export default function DesktopTitleBar() {
  if (!isDesktop) return null;

  const [maximized, setMaximized] = createSignal(false);

  const invoke = (cmd: string) =>
    (window as any).__TAURI_INTERNALS__?.invoke(cmd, { label: "main" });

  const handleDrag = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    invoke("plugin:window|start_dragging");
  };

  const minimize = () => invoke("plugin:window|minimize");

  const toggleMaximize = async () => {
    await invoke("plugin:window|toggle_maximize");
    try {
      setMaximized(await invoke("plugin:window|is_maximized"));
    } catch {}
  };

  const close = () => invoke("plugin:window|close");

  const btnStyle = {
    width: "36px",
    height: "32px",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    color: "var(--text-muted)",
    "font-size": "16px",
    "background-color": "transparent",
    border: "none",
    cursor: "pointer",
  };

  return (
    <div
      onMouseDown={handleDrag}
      style={{
        height: "32px",
        "min-height": "32px",
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        "background-color": "var(--bg-secondary)",
        "border-bottom": "1px solid var(--border-gold)",
        padding: "0 12px 0 16px",
        "-webkit-user-select": "none",
        "user-select": "none",
        cursor: "default",
      }}
    >
      <span
        style={{
          "font-family": "var(--font-display)",
          "font-size": "11px",
          "font-weight": "700",
          color: "var(--accent)",
          "letter-spacing": "1.5px",
          "pointer-events": "none",
        }}
      >
        LE FAUX PAIN
      </span>
      <div style={{ display: "flex" }}>
        <button onClick={minimize} style={btnStyle} title="Minimize">
          {"−"}
        </button>
        <button onClick={toggleMaximize} style={btnStyle} title={maximized() ? "Restore" : "Maximize"}>
          {maximized() ? "\u2750" : "\u25A1"}
        </button>
        <button onClick={close} style={{ ...btnStyle, "font-size": "18px" }} title="Close">
          {"\u00D7"}
        </button>
      </div>
    </div>
  );
}
