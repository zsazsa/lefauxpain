import { createSignal, lazy, Show } from "solid-js";
import { selectedChannelId, channels, selectedChannel } from "../../stores/channels";
import { connState } from "../../lib/ws";
import { watchingScreenShare } from "../../stores/voice";
import { watchingMedia, selectedMediaId } from "../../stores/media";
import { tunedStationId } from "../../stores/radio";
import { activePatternId, viewingPattern } from "../../stores/strudel";
const StrudelEditor = lazy(() => import("../Strudel/StrudelEditor"));
import TerminalTitleBar from "./TerminalTitleBar";
import TerminalInput from "./TerminalInput";
import StatusStrip from "./StatusStrip";
import MessageList from "../TextChannel/MessageList";
import VoiceChannel from "../VoiceChannel/VoiceChannel";
import ScreenShareView from "../VoiceChannel/ScreenShareView";
import MediaPlayer from "../MediaPlayer/MediaPlayer";
import RadioPlayer from "../RadioPlayer/RadioPlayer";
import ChannelListDialog from "./dialogs/ChannelListDialog";
import MembersDialog from "./dialogs/MembersDialog";
import HelpDialog from "./dialogs/HelpDialog";
import NotificationsDialog from "./dialogs/NotificationsDialog";
import RadioDialog from "./dialogs/RadioDialog";
import PatternListDialog from "./dialogs/PatternListDialog";
import type { CommandContext } from "./commandExecutor";

interface TerminalLayoutProps {
  onLogout: () => void;
}

export default function TerminalLayout(props: TerminalLayoutProps) {
  const [dialog, setDialog] = createSignal<{ id: string; props?: any } | null>(null);
  const [statusMsg, setStatusMsg] = createSignal<string | null>(null);
  let statusTimer: number | undefined;
  let terminalInputRef: HTMLInputElement | undefined;

  const handleLayoutClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [contenteditable]")) return;
    terminalInputRef?.focus();
  };

  const showStatus = (msg: string) => {
    setStatusMsg(msg);
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => setStatusMsg(null), 5000);
  };

  const openDialog = (id: string, dialogProps?: any) => {
    setDialog({ id, props: dialogProps });
  };

  const closeDialog = () => {
    setDialog(null);
  };

  const commandCtx: CommandContext = {
    openDialog,
    closeDialog,
    setStatus: showStatus,
    onLogout: props.onLogout,
  };

  const ch = () => {
    const id = selectedChannelId();
    if (!id) return null;
    return channels().find((c) => c.id === id) || null;
  };

  return (
    <div
      onClick={handleLayoutClick}
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "background-color": "var(--bg-primary)",
        position: "relative",
      }}
    >
      <TerminalTitleBar onHelp={() => openDialog("help")} />

      {/* Connection banner */}
      <Show when={connState() !== "connected"}>
        <div style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          gap: "10px",
          padding: "6px 12px",
          "background-color": connState() === "reconnecting"
            ? "rgba(201,168,76,0.15)"
            : "rgba(220,50,50,0.15)",
          "border-bottom": connState() === "reconnecting"
            ? "1px solid rgba(201,168,76,0.3)"
            : "1px solid rgba(220,50,50,0.3)",
          "font-size": "12px",
          color: connState() === "reconnecting" ? "var(--accent)" : "var(--danger)",
        }}>
          <span style={{
            width: "7px",
            height: "7px",
            "border-radius": "50%",
            "background-color": "currentColor",
            animation: connState() === "reconnecting" ? "pulse 1.5s ease-in-out infinite" : "none",
          }} />
          {connState() === "reconnecting" ? "Waiting for connection..." : "Offline"}
        </div>
      </Show>

      {/* Floating PiP media player */}
      <Show when={watchingMedia() && selectedMediaId()}>
        <MediaPlayer />
      </Show>

      {/* Floating radio player */}
      <Show when={tunedStationId()}>
        <RadioPlayer />
      </Show>

      {/* Main content area */}
      <div style={{ flex: "1", "min-height": "0", display: "flex", "flex-direction": "column" }}>
        {() => {
          const watching = watchingScreenShare();
          if (watching) {
            return <ScreenShareView userId={watching.user_id} channelId={watching.channel_id} />;
          }
          const patternId = activePatternId();
          if (patternId && viewingPattern()) {
            return <StrudelEditor patternId={patternId} />;
          }
          const id = selectedChannelId();
          if (!id) {
            return (
              <div style={{
                flex: "1",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                color: "var(--text-muted)",
                "font-size": "13px",
              }}>
                Type /channels to select a channel
              </div>
            );
          }
          const channel = ch();
          if (!channel) return null;
          if (channel.type === "text") {
            return <MessageList channelId={id} />;
          }
          if (channel.type === "voice") {
            return <VoiceChannel channelId={id} />;
          }
          return null;
        }}
      </div>

      {/* Status strip */}
      <StatusStrip />

      {/* Status message toast */}
      <Show when={statusMsg()}>
        <div style={{
          padding: "4px 12px",
          "font-size": "11px",
          color: "var(--text-secondary)",
          "background-color": "var(--bg-secondary)",
          "border-top": "1px solid var(--border-gold)",
        }}>
          {statusMsg()}
        </div>
      </Show>

      {/* Input */}
      <TerminalInput channelId={selectedChannelId()} commandCtx={commandCtx} dialogOpen={!!dialog()} inputRef={(el) => terminalInputRef = el} />

      {/* Dialog overlay */}
      {() => {
        const d = dialog();
        if (!d) return null;
        switch (d.id) {
          case "channels":
            return <ChannelListDialog onClose={closeDialog} />;
          case "members":
            return <MembersDialog onClose={closeDialog} />;
          case "help":
            return <HelpDialog onClose={closeDialog} />;
          case "notifications":
            return <NotificationsDialog onClose={closeDialog} />;
          case "voice":
            return <ChannelListDialog onClose={closeDialog} />;
          case "radio":
            return <RadioDialog onClose={closeDialog} />;
          case "patterns":
            return <PatternListDialog onClose={closeDialog} />;
          default:
            return null;
        }
      }}
    </div>
  );
}
