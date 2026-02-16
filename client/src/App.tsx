import { createSignal, onCleanup, onMount, Show } from "solid-js";
import Login from "./components/Auth/Login";
import Sidebar from "./components/Sidebar/Sidebar";
import TextChannel from "./components/TextChannel/TextChannel";
import VoiceChannel from "./components/VoiceChannel/VoiceChannel";
import SettingsModal from "./components/Settings/SettingsModal";
import DesktopTitleBar from "./components/DesktopTitleBar";
import ScreenShareView from "./components/VoiceChannel/ScreenShareView";
import { connectWS, disconnectWS, connState } from "./lib/ws";
import { initEventHandlers } from "./lib/events";
import { leaveVoice } from "./lib/webrtc";
import { cleanupScreenShare } from "./lib/screenshare";
import { currentUser, token, login, logout, setUser } from "./stores/auth";
import {
  channels,
  selectedChannelId,
  selectedChannel,
} from "./stores/channels";
import { watchingScreenShare } from "./stores/voice";
import { isMobile, sidebarOpen, setSidebarOpen, initResponsive } from "./stores/responsive";
import { startUpdateChecker } from "./stores/updateChecker";

function App() {
  const [ready, setReady] = createSignal(false);
  let cleanupEvents: (() => void) | null = null;

  const handleLogin = (newToken: string, username: string, user: any) => {
    login(user, newToken);
  };

  const handleLogout = () => {
    cleanupScreenShare();
    leaveVoice();
    disconnectWS();
    if (cleanupEvents) {
      cleanupEvents();
      cleanupEvents = null;
    }
    logout();
    setReady(false);
  };

  // Connect WS when we have a token
  onMount(() => {
    const cleanupResponsive = initResponsive();
    onCleanup(cleanupResponsive);
    startUpdateChecker();

    const t = token();
    if (t) {
      cleanupEvents = initEventHandlers();
      connectWS(t);
      setReady(true);
      onCleanup(() => {
        if (cleanupEvents) {
          cleanupEvents();
          cleanupEvents = null;
        }
        disconnectWS();
      });
    }
  });

  // Re-connect when token changes (after login)
  const connectOnLogin = () => {
    const t = token();
    if (t && !ready()) {
      if (cleanupEvents) cleanupEvents();
      cleanupEvents = initEventHandlers();
      connectWS(t);
      setReady(true);
    }
  };

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "var(--app-height, 100vh)", overflow: "hidden" }}>
      <DesktopTitleBar />
      <div style={{ flex: "1", "min-height": "0" }}>
        <Show
          when={token()}
          fallback={
            <Login
              onLogin={(t, username) => {
                handleLogin(t, username, { id: "", username, avatar_url: null });
                setTimeout(connectOnLogin, 0);
              }}
            />
          }
        >
          <div
            style={{
              display: "flex",
              height: "100%",
              "background-color": "var(--bg-primary)",
            }}
          >
        <SettingsModal />

        {/* Sidebar wrapper */}
        {() => {
          if (isMobile()) {
            return (
              <>
                {/* Backdrop */}
                <Show when={sidebarOpen()}>
                  <div
                    onClick={() => setSidebarOpen(false)}
                    style={{
                      position: "fixed",
                      inset: "0",
                      "background-color": "rgba(0,0,0,0.6)",
                      "z-index": "99",
                    }}
                  />
                </Show>
                {/* Drawer */}
                <div
                  style={{
                    position: "fixed",
                    top: "0",
                    left: "0",
                    bottom: "0",
                    width: "280px",
                    "z-index": "100",
                    transform: sidebarOpen() ? "translateX(0)" : "translateX(-100%)",
                    transition: "transform 0.2s ease",
                  }}
                >
                  <Sidebar
                    onLogout={handleLogout}
                    username={
                      currentUser()?.username ||
                      localStorage.getItem("username") ||
                      ""
                    }
                  />
                </div>
              </>
            );
          } else {
            return (
              <div style={{ width: "240px", "min-width": "240px" }}>
                <Sidebar
                  onLogout={handleLogout}
                  username={
                    currentUser()?.username ||
                    localStorage.getItem("username") ||
                    ""
                  }
                />
              </div>
            );
          }
        }}

        <div style={{ flex: "1", display: "flex", "flex-direction": "column", "min-width": "0" }}>
          <Show when={connState() !== "connected"}>
            <div style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              gap: "10px",
              padding: "10px 16px",
              "background-color": connState() === "reconnecting"
                ? "rgba(201,168,76,0.15)"
                : "rgba(220,50,50,0.15)",
              "border-bottom": connState() === "reconnecting"
                ? "1px solid rgba(201,168,76,0.3)"
                : "1px solid rgba(220,50,50,0.3)",
              "font-size": "13px",
              color: connState() === "reconnecting" ? "var(--accent)" : "var(--danger)",
            }}>
              <span style={{
                width: "8px",
                height: "8px",
                "border-radius": "50%",
                "background-color": "currentColor",
                animation: connState() === "reconnecting" ? "pulse 1.5s ease-in-out infinite" : "none",
                "flex-shrink": "0",
              }} />
              {connState() === "reconnecting"
                ? "Waiting for connection..."
                : "Offline"}
            </div>
          </Show>
          {() => {
            const watching = watchingScreenShare();
            if (watching) {
              return <ScreenShareView userId={watching.user_id} channelId={watching.channel_id} />;
            }
            const id = selectedChannelId();
            if (!id) {
              return (
                <div
                  class="crt-vignette"
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "center",
                    "justify-content": "center",
                    height: "100%",
                    color: "var(--text-muted)",
                    "font-size": "13px",
                    gap: "16px",
                  }}
                >
                  <Show when={isMobile()}>
                    <button
                      onClick={() => setSidebarOpen(true)}
                      style={{
                        "font-size": "14px",
                        color: "var(--accent)",
                        padding: "8px 16px",
                        border: "1px solid var(--border-gold)",
                        "background-color": "transparent",
                      }}
                    >
                      [{"\u2261"} open canaux]
                    </button>
                  </Show>
                  <Show when={!isMobile()}>
                    <div style={{ "text-align": "center" }}>
                      <div style={{
                        "font-family": "var(--font-display)",
                        "font-size": "18px",
                        color: "var(--accent)",
                        "margin-bottom": "8px",
                        "letter-spacing": "2px",
                      }}>
                        Le Faux Pain
                      </div>
                      <span style={{ color: "var(--text-muted)" }}>// select a channel to begin</span>
                    </div>
                  </Show>
                </div>
              );
            }
            const ch = channels().find((c) => c.id === id);
            if (!ch) return null;
            if (ch.type === "text") return <TextChannel channelId={id} />;
            if (ch.type === "voice") return <VoiceChannel channelId={id} />;
            return null;
          }}
        </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

export default App;
