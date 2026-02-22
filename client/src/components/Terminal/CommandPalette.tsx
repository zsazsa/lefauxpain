import { createSignal, createEffect, For, Show } from "solid-js";
import { commands, type CommandDef } from "./commandRegistry";
import { fuzzyMatch } from "./fuzzyMatch";
import { currentUser } from "../../stores/auth";

interface CommandPaletteProps {
  query: string;
  selectedIndex: number;
  onSelect: (cmd: CommandDef) => void;
  onHover: (index: number) => void;
}

export default function CommandPalette(props: CommandPaletteProps) {
  let listRef: HTMLDivElement | undefined;

  const filtered = () => {
    const q = props.query;
    const isAdmin = currentUser()?.is_admin ?? false;

    const available = commands.filter((c) => !c.adminOnly || isAdmin);

    if (!q) return available;

    const scored: { cmd: CommandDef; score: number }[] = [];
    for (const cmd of available) {
      const s = fuzzyMatch(q, cmd.name);
      if (s !== null) scored.push({ cmd, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.cmd);
  };

  // Scroll selected item into view
  createEffect(() => {
    const idx = props.selectedIndex;
    if (listRef) {
      const el = listRef.children[idx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  });

  return (
    <Show when={filtered().length > 0}>
      <div
        ref={listRef}
        style={{
          position: "absolute",
          bottom: "100%",
          left: "0",
          right: "0",
          "max-height": "300px",
          overflow: "auto",
          "background-color": "var(--bg-secondary)",
          border: "1px solid var(--border-gold)",
          "border-bottom": "none",
          "z-index": "50",
        }}
      >
        <For each={filtered()}>
          {(cmd, i) => {
            const isNewGroup = () => {
              const idx = i();
              if (idx === 0) return false;
              const list = filtered();
              return list[idx - 1]?.category !== cmd.category;
            };
            return (
            <div
              onClick={() => props.onSelect(cmd)}
              onMouseOver={() => props.onHover(i())}
              style={{
                padding: "6px 12px",
                cursor: "pointer",
                display: "flex",
                "align-items": "baseline",
                gap: "8px",
                "background-color": i() === props.selectedIndex
                  ? "var(--accent-glow)"
                  : "transparent",
                "font-size": "13px",
                ...(isNewGroup() ? { "border-top": "1px solid var(--border-gold)", "margin-top": "4px", "padding-top": "8px" } : {}),
              }}
            >
              <span style={{ color: "var(--accent)", "font-weight": "600", "flex-shrink": "0" }}>
                /{cmd.name}
              </span>
              <Show when={cmd.args}>
                <span style={{ color: "var(--text-muted)", "font-size": "11px", "flex-shrink": "0" }}>
                  {cmd.args}
                </span>
              </Show>
              <span style={{
                color: "var(--text-secondary)",
                "font-size": "12px",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}>
                {cmd.description}
              </span>
            </div>
          );}}
        </For>
      </div>
    </Show>
  );
}

/** Get filtered commands for external use (e.g. Tab completion) */
export function getFilteredCommands(query: string, isAdmin: boolean): CommandDef[] {
  const available = commands.filter((c) => !c.adminOnly || isAdmin);
  if (!query) return available;

  const scored: { cmd: CommandDef; score: number }[] = [];
  for (const cmd of available) {
    const s = fuzzyMatch(query, cmd.name);
    if (s !== null) scored.push({ cmd, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.cmd);
}
