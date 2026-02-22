import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { radioStations, tunedStationId, setTunedStationId, getStationPlayback, getStationListeners } from "../../../stores/radio";
import { send } from "../../../lib/ws";
import TerminalDialog from "../TerminalDialog";

interface RadioDialogProps {
  onClose: () => void;
}

export default function RadioDialog(props: RadioDialogProps) {
  const [selectedIdx, setSelectedIdx] = createSignal(0);

  const stations = () => radioStations();

  onMount(() => {
    const idx = stations().findIndex((s) => s.id === tunedStationId());
    if (idx >= 0) setSelectedIdx(idx);
  });

  const handleSelect = (stationId: string) => {
    setTunedStationId(stationId);
    send("radio_tune", { station_id: stationId });
    props.onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const list = stations();
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
      const station = list[selectedIdx()];
      if (station) handleSelect(station.id);
    }
  };

  onMount(() => document.addEventListener("keydown", handleKeyDown, true));
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown, true));

  return (
    <TerminalDialog title="RADIO STATIONS" onClose={props.onClose}>
      <Show when={stations().length > 0} fallback={
        <div style={{ color: "var(--text-muted)", "font-size": "12px", padding: "8px 0" }}>
          No radio stations
        </div>
      }>
        <For each={stations()}>
          {(station, i) => {
            const pb = () => getStationPlayback(station.id);
            const listeners = () => getStationListeners(station.id);
            const isTuned = () => tunedStationId() === station.id;
            return (
              <div
                onClick={() => handleSelect(station.id)}
                onMouseOver={() => setSelectedIdx(i())}
                style={{
                  padding: "6px 8px",
                  cursor: "pointer",
                  "background-color": i() === selectedIdx()
                    ? "var(--accent-glow)"
                    : "transparent",
                  "font-size": "13px",
                  color: isTuned() ? "var(--accent)" : "var(--text-secondary)",
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                }}
              >
                <span style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                  <span>{"\uD83D\uDCFB"}</span>
                  <span>{station.name}</span>
                  <Show when={isTuned()}>
                    <span style={{ "font-size": "10px", color: "var(--accent)" }}>(tuned)</span>
                  </Show>
                </span>
                <span style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "11px", color: "var(--text-muted)" }}>
                  <Show when={pb()}>
                    <span>
                      {pb()!.playing ? "\u25B6" : "\u23F8"}{" "}
                      {pb()!.track.filename}
                    </span>
                  </Show>
                  <Show when={!pb()}>
                    <span>stopped</span>
                  </Show>
                  <span>{listeners().length} listening</span>
                </span>
              </div>
            );
          }}
        </For>
      </Show>
    </TerminalDialog>
  );
}
