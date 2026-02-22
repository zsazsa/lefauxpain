import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { strudelPatterns, setActivePatternId, getPatternViewers, getPatternPlayback } from "../../../stores/strudel";
import { currentUser } from "../../../stores/auth";
import { lookupUsername } from "../../../stores/users";
import TerminalDialog from "../TerminalDialog";

interface PatternListDialogProps {
  onClose: () => void;
}

export default function PatternListDialog(props: PatternListDialogProps) {
  const [selectedIdx, setSelectedIdx] = createSignal(0);

  const patterns = () => strudelPatterns();

  const handleSelect = (patternId: string) => {
    setActivePatternId(patternId);
    props.onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const list = patterns();
    if (!list.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIdx((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const pat = list[selectedIdx()];
      if (pat) handleSelect(pat.id);
    }
  };

  onMount(() => document.addEventListener("keydown", handleKeyDown, true));
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown, true));

  return (
    <TerminalDialog title="PATTERNS" onClose={props.onClose}>
      <Show when={patterns().length > 0} fallback={
        <div style={{ color: "var(--text-muted)", "font-size": "12px", padding: "8px 0" }}>
          No patterns yet. Use /pattern-new to create one.
        </div>
      }>
        <For each={patterns()}>
          {(pattern, i) => {
            const pb = () => getPatternPlayback(pattern.id);
            const viewers = () => getPatternViewers(pattern.id);
            const isOwner = () => currentUser()?.id === pattern.owner_id;
            const ownerName = () => lookupUsername(pattern.owner_id) || "unknown";

            return (
              <div
                onClick={() => handleSelect(pattern.id)}
                onMouseOver={() => setSelectedIdx(i())}
                style={{
                  padding: "6px 8px",
                  cursor: "pointer",
                  "background-color": i() === selectedIdx()
                    ? "var(--accent-glow)"
                    : "transparent",
                  "font-size": "13px",
                  color: isOwner() ? "var(--accent)" : "var(--text-secondary)",
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                }}
              >
                <span style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                  <span>{pb()?.playing ? "\u25B6" : "\u25B7"}</span>
                  <span>{pattern.name}</span>
                  <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>
                    [{pattern.visibility}]
                  </span>
                </span>
                <span style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "11px", color: "var(--text-muted)" }}>
                  <span>by {ownerName()}</span>
                  <Show when={viewers().length > 0}>
                    <span>{viewers().length} viewing</span>
                  </Show>
                </span>
              </div>
            );
          }}
        </For>
      </Show>
    </TerminalDialog>
  );
}
