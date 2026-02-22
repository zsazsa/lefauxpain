import { onMount, onCleanup, type JSXElement } from "solid-js";

interface TerminalDialogProps {
  title: string;
  onClose: () => void;
  children: JSXElement;
}

export default function TerminalDialog(props: TerminalDialogProps) {
  let dialogRef: HTMLDivElement | undefined;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown, true));
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: "0",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "background-color": "rgba(0,0,0,0.5)",
        "z-index": "40",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={dialogRef}
        style={{
          "min-width": "320px",
          "max-width": "500px",
          "max-height": "70vh",
          width: "90%",
          "background-color": "var(--bg-primary)",
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
        }}
      >
        {/* Top border with title */}
        <div
          style={{
            padding: "6px 12px",
            "font-size": "12px",
            color: "var(--accent)",
            "font-weight": "600",
            "letter-spacing": "1px",
            "text-transform": "uppercase",
            "border-top": "2px double var(--border-gold)",
            "border-left": "2px double var(--border-gold)",
            "border-right": "2px double var(--border-gold)",
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            "background-color": "var(--bg-secondary)",
          }}
        >
          <span>{"\u2554\u2550\u2550"} {props.title} {"\u2550\u2550\u2557"}</span>
          <button
            onClick={props.onClose}
            style={{
              "font-size": "11px",
              color: "var(--text-muted)",
              padding: "0 4px",
            }}
          >
            [x]
          </button>
        </div>
        {/* Content */}
        <div
          style={{
            flex: "1",
            overflow: "auto",
            padding: "8px 12px",
            "border-left": "2px double var(--border-gold)",
            "border-right": "2px double var(--border-gold)",
          }}
        >
          {props.children}
        </div>
        {/* Bottom border with hints */}
        <div
          style={{
            padding: "4px 12px",
            "font-size": "10px",
            color: "var(--text-muted)",
            "border-bottom": "2px double var(--border-gold)",
            "border-left": "2px double var(--border-gold)",
            "border-right": "2px double var(--border-gold)",
            "background-color": "var(--bg-secondary)",
          }}
        >
          {"\u2559"} [{"\u2191\u2193"} Navigate] [Enter Select] [Esc Close] {"\u255C"}
        </div>
      </div>
    </div>
  );
}
