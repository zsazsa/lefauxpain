import { createSignal, createEffect, on, For, Show, onCleanup } from "solid-js";
import { channels, selectedChannelId, setSelectedChannelId } from "../../stores/channels";
import {
  getUsersInVoiceChannel,
  currentVoiceChannelId,
  screenShares,
  setWatchingScreenShare,
} from "../../stores/voice";
import { subscribeScreenShare } from "../../lib/screenshare";
import { onlineUsers, allUsers } from "../../stores/users";
import { currentUser } from "../../stores/auth";
import { joinVoice } from "../../lib/webrtc";
import { setSettingsOpen, setSettingsTab } from "../../stores/settings";
import { updateStatus, updateVersion } from "../../stores/updateChecker";
import { unreadCount } from "../../stores/notifications";
import { isMobile, setSidebarOpen } from "../../stores/responsive";
import { connState, ping } from "../../lib/ws";
import { mediaList, mediaPlayback, setWatchingMedia, setSelectedMediaId } from "../../stores/media";
import { deleteMedia } from "../../lib/api";
import ChannelItem from "./ChannelItem";
import CreateChannel from "./CreateChannel";
import VoiceControls from "../VoiceChannel/VoiceControls";
import NotificationDropdown from "../Notifications/NotificationDropdown";
import { t } from "../../stores/theme";
import { isAppletEnabled } from "../../stores/applets";
import RadioSidebar from "./RadioSidebar";
import StrudelSidebar from "./StrudelSidebar";
import { setUIMode } from "../../stores/mode";
import { isFeatureEnabled } from "../../stores/strudel";

interface SidebarProps {
  onLogout: () => void;
  username: string;
}

export default function Sidebar(props: SidebarProps) {
  const voiceChannels = () => channels().filter((c) => c.type === "voice");
  const textChannels = () => channels().filter((c) => c.type === "text");
  const canManage = (ch: { manager_ids: string[] }) => {
    const user = currentUser();
    if (!user) return false;
    return user.is_admin || ch.manager_ids.includes(user.id);
  };
  const [notifOpen, setNotifOpen] = createSignal(false);
  const [shaking, setShaking] = createSignal(false);
  let headerRef: HTMLDivElement | undefined;
  let bellRef: HTMLButtonElement | undefined;

  // Shake for 20s when unread count increases
  let shakeTimer: number | undefined;
  createEffect(on(unreadCount, (count, prev) => {
    if (count > 0 && (prev === undefined || count > prev)) {
      setShaking(true);
      clearTimeout(shakeTimer);
      shakeTimer = window.setTimeout(() => setShaking(false), 20000);
    }
    if (count === 0) {
      setShaking(false);
      clearTimeout(shakeTimer);
    }
  }));
  onCleanup(() => clearTimeout(shakeTimer));

  return (
    <div
      style={{
        width: "100%",
        "background-color": "var(--bg-secondary)",
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "border-right": "1px solid var(--border-gold)",
      }}
    >
      {/* Header */}
      <div
        ref={headerRef}
        style={{
          padding: "0 16px",
          height: "41px",
          "border-bottom": "1px solid var(--border-gold)",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
        }}
      >
        <span style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          "font-size": "12px",
          color: "var(--text-muted)",
        }}>
          <span style={{
            width: "7px",
            height: "7px",
            "border-radius": "50%",
            "background-color": connState() === "connected"
              ? "var(--success)"
              : connState() === "reconnecting"
                ? "var(--accent)"
                : "var(--danger)",
            "flex-shrink": "0",
          }} />
          {connState() === "connected" ? (
            <span>
              <span style={{ color: "var(--text-secondary)" }}>
                {onlineUsers().length + 1} {t("online")}
              </span>
              {ping() !== null && (
                <span style={{
                  color: ping()! < 100 ? "var(--text-muted)" : ping()! < 300 ? "var(--accent)" : "var(--danger)",
                }}>
                  {" \u00B7 "}{ping()}ms
                </span>
              )}
            </span>
          ) : (
            <span style={{ color: "var(--accent)" }}>
              {connState() === "reconnecting" ? "reconnecting..." : "offline"}
            </span>
          )}
        </span>
        <button
          ref={bellRef}
          onClick={() => setNotifOpen((v) => !v)}
          style={{
            position: "relative",
            padding: "2px 6px",
            "font-size": "18px",
            "line-height": "1",
            filter: unreadCount() > 0 ? "none" : "grayscale(1) brightness(0.7)",
            animation: shaking() ? "bread-shake 0.4s ease-in-out infinite" : "none",
          }}
          title="Notifications"
        >
          {"\u{1F956}"}
          <Show when={unreadCount() > 0}>
            <span
              style={{
                position: "absolute",
                top: "-2px",
                right: "0",
                "background-color": "var(--cyan)",
                color: "var(--bg-primary)",
                "font-size": "10px",
                "font-weight": "700",
                "min-width": "16px",
                height: "16px",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                padding: "0 4px",
              }}
            >
              {unreadCount()}
            </span>
          </Show>
        </button>
        <Show when={notifOpen()}>
          <NotificationDropdown anchorRef={isMobile() ? headerRef! : bellRef!} onClose={() => setNotifOpen(false)} />
        </Show>
      </div>

      {/* Channel list */}
      <div style={{ flex: "1", overflow: "auto", padding: "8px 0" }}>
        <Show when={voiceChannels().length > 0}>
          <div
            style={{
              padding: "8px 16px 4px",
              "font-family": "var(--font-display)",
              "font-size": "11px",
              "font-weight": "600",
              "text-transform": "uppercase",
              "letter-spacing": "2px",
              color: "var(--text-muted)",
            }}
          >
            {t("voiceChannels")}
          </div>
          <For each={voiceChannels()}>
            {(ch) => (
              <>
                <ChannelItem
                  channel={ch}
                  selected={selectedChannelId() === ch.id}
                  canManage={canManage(ch)}
                  onClick={() => {
                    setSelectedChannelId(ch.id);
                    if (currentVoiceChannelId() !== ch.id) {
                      joinVoice(ch.id);
                    }
                    if (isMobile()) setSidebarOpen(false);
                  }}
                />
                {/* Users in this voice channel */}
                <For each={getUsersInVoiceChannel(ch.id)}>
                  {(vs) => {
                    const user = () =>
                      onlineUsers().find((u) => u.id === vs.user_id) ||
                      (currentUser()?.id === vs.user_id ? currentUser() : null);
                    return (
                      <Show when={user()}>
                        <div
                          style={{
                            padding: "1px 16px 1px 40px",
                            "font-size": "12px",
                            color: "var(--text-secondary)",
                            display: "flex",
                            "align-items": "center",
                            gap: "6px",
                          }}
                        >
                          <span
                            style={{
                              color: vs.speaking
                                ? "var(--success)"
                                : "var(--text-muted)",
                              "font-size": "8px",
                            }}
                          >
                            {"\u25CF"}
                          </span>
                          <span>{user()!.username}</span>
                          {vs.self_mute && (
                            <span style={{ "font-size": "10px" }}>
                              {"\u{1F507}"}
                            </span>
                          )}
                          {vs.self_deafen && (
                            <span style={{ "font-size": "10px" }}>
                              {"\u{1F508}"}
                            </span>
                          )}
                          {screenShares().some((s) => s.user_id === vs.user_id) && (
                            <span style={{ "font-size": "10px" }}>
                              {"\uD83D\uDDA5"}
                            </span>
                          )}
                        </div>
                      </Show>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </Show>

        <Show when={textChannels().length > 0}>
          <div
            style={{
              padding: "8px 16px 4px",
              "font-family": "var(--font-display)",
              "font-size": "11px",
              "font-weight": "600",
              "text-transform": "uppercase",
              "letter-spacing": "2px",
              color: "var(--text-muted)",
              "margin-top": "8px",
            }}
          >
            {t("textChannels")}
          </div>
          <For each={textChannels()}>
            {(ch) => (
              <ChannelItem
                channel={ch}
                selected={selectedChannelId() === ch.id}
                canManage={canManage(ch)}
                onClick={() => {
                  setSelectedChannelId(ch.id);
                  if (isMobile()) setSidebarOpen(false);
                }}
              />
            )}
          </For>
        </Show>

        <CreateChannel />

        {/* Media library */}
        <Show when={isAppletEnabled("media") && mediaList().length > 0}>
          <div
            style={{
              padding: "8px 16px 4px",
              "font-family": "var(--font-display)",
              "font-size": "11px",
              "font-weight": "600",
              "text-transform": "uppercase",
              "letter-spacing": "2px",
              color: "var(--text-muted)",
              "margin-top": "8px",
            }}
          >
            MEDIA
          </div>
          <For each={mediaList()}>
            {(item) => {
              const isActive = () => mediaPlayback()?.video_id === item.id;
              return (
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    padding: "3px 16px 3px 24px",
                    cursor: "pointer",
                    "font-size": "12px",
                    color: isActive() ? "var(--accent)" : "var(--text-secondary)",
                    "background-color": isActive() ? "var(--accent-glow)" : "transparent",
                  }}
                >
                  <span
                    onClick={() => {
                      setSelectedMediaId(item.id);
                      setWatchingMedia(true);
                      if (isMobile()) setSidebarOpen(false);
                    }}
                    style={{
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                      flex: "1",
                      "min-width": "0",
                    }}
                    title={item.filename}
                  >
                    {isActive() ? "\u25B6 " : "\u25B7 "}{item.filename}
                  </span>
                  <Show when={currentUser()?.is_admin}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${item.filename}"?`)) {
                          deleteMedia(item.id).catch(() => {});
                        }
                      }}
                      style={{
                        "font-size": "10px",
                        color: "var(--text-muted)",
                        padding: "0 4px",
                        "flex-shrink": "0",
                      }}
                    >
                      [x]
                    </button>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>

        {/* Radio stations */}
        <Show when={isAppletEnabled("radio")}>
          <RadioSidebar />
        </Show>

        {/* Strudel patterns */}
        <Show when={isFeatureEnabled("strudel")}>
          <StrudelSidebar />
        </Show>

        {/* Online users */}
        <div
          style={{
            padding: "12px 16px 4px",
            "font-family": "var(--font-display)",
            "font-size": "11px",
            "font-weight": "600",
            "text-transform": "uppercase",
            "letter-spacing": "2px",
            color: "var(--text-muted)",
            "margin-top": "8px",
          }}
        >
          {t("members")} — {allUsers().length}
        </div>
        <div style={{ padding: "4px 16px" }}>
          {/* Online users (current user first) */}
          <Show when={currentUser()}>
            <div
              style={{
                padding: "2px 0",
                "font-size": "12px",
                color: "var(--accent)",
                display: "flex",
                "align-items": "center",
                gap: "6px",
              }}
            >
              <span style={{ color: "var(--success)", "font-size": "8px" }}>{"\u25CF"}</span>
              {currentUser()!.username}
              <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>(you)</span>
            </div>
          </Show>
          <For each={onlineUsers()}>
            {(user) => {
              const isSharing = () => screenShares().some((s) => s.user_id === user.id);
              const canWatch = () => isSharing();
              const handleClick = () => {
                if (!canWatch()) return;
                const share = screenShares().find((s) => s.user_id === user.id)!;
                setWatchingScreenShare({ user_id: share.user_id, channel_id: share.channel_id });
                subscribeScreenShare(share.channel_id);
                if (isMobile()) setSidebarOpen(false);
              };
              return (
                <div
                  onClick={handleClick}
                  style={{
                    padding: "2px 0",
                    "font-size": "12px",
                    color: "var(--text-secondary)",
                    display: "flex",
                    "align-items": "center",
                    gap: "6px",
                    cursor: canWatch() ? "pointer" : "default",
                  }}
                >
                  <span style={{
                    color: isSharing() ? "var(--accent)" : "var(--success)",
                    "font-size": isSharing() ? "10px" : "8px",
                  }}>
                    {isSharing() ? "\uD83D\uDDA5" : "\u25CF"}
                  </span>
                  {user.username}
                </div>
              );
            }}
          </For>

          {/* Offline users */}
          <For each={allUsers().filter((u) => {
            const me = currentUser();
            if (me && u.id === me.id) return false;
            return !onlineUsers().some((o) => o.id === u.id);
          })}>
            {(user) => (
              <div
                style={{
                  padding: "2px 0",
                  "font-size": "12px",
                  color: "var(--text-muted)",
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  opacity: "0.5",
                }}
              >
                <span style={{ color: "var(--text-muted)", "font-size": "8px" }}>{"\u25CF"}</span>
                {user.username}
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Voice controls */}
      <VoiceControls />

      {/* Update banner */}
      <Show when={updateStatus() === "available"}>
        <button
          onClick={() => {
            setSettingsTab("app");
            setSettingsOpen(true);
          }}
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            width: "100%",
            padding: "6px 12px",
            "background-color": "rgba(201,168,76,0.1)",
            "border-top": "1px solid var(--border-gold)",
            "font-size": "11px",
            color: "var(--accent)",
            cursor: "pointer",
          }}
        >
          {"\u2191"} Update {updateVersion()} available
        </button>
      </Show>

      {/* User bar */}
      <div
        style={{
          padding: "14px 12px",
          "background-color": "var(--bg-primary)",
          "border-top": "1px solid var(--border-gold)",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "font-size": "13px",
        }}
      >
        <span style={{ color: "var(--accent)", "font-weight": "600" }}>
          {props.username}
        </span>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={() => setUIMode("terminal")}
            style={{
              padding: "2px 6px",
              "font-size": "11px",
              color: "var(--text-muted)",
            }}
            title="Terminal mode"
          >
            [{">_"}]
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            style={{
              padding: "2px 6px",
              "font-size": "18px",
              color: "var(--text-muted)",
            }}
            title="Settings"
          >
            {"\u2699"}
          </button>
          <button
            onClick={props.onLogout}
            style={{
              padding: "2px 6px",
              "font-size": "11px",
              color: "var(--text-muted)",
            }}
          >
            [logout]
          </button>
        </div>
      </div>
    </div>
  );
}
