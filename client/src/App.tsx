import { createSignal, onCleanup, onMount, Show } from "solid-js";
import Login from "./components/Auth/Login";
import Sidebar from "./components/Sidebar/Sidebar";
import TextChannel from "./components/TextChannel/TextChannel";
import VoiceChannel from "./components/VoiceChannel/VoiceChannel";
import SettingsModal from "./components/Settings/SettingsModal";
import DesktopTitleBar from "./components/DesktopTitleBar";
import { connectWS, disconnectWS } from "./lib/ws";
import { initEventHandlers } from "./lib/events";
import { currentUser, token, login, logout, setUser } from "./stores/auth";
import {
  channels,
  selectedChannelId,
  selectedChannel,
} from "./stores/channels";
import { isMobile, sidebarOpen, setSidebarOpen, initResponsive } from "./stores/responsive";

function App() {
  const [ready, setReady] = createSignal(false);

  const handleLogin = (newToken: string, username: string, user: any) => {
    login(user, newToken);
  };

  const handleLogout = () => {
    disconnectWS();
    logout();
    setReady(false);
  };

  // Connect WS when we have a token
  onMount(() => {
    const cleanupResponsive = initResponsive();
    onCleanup(cleanupResponsive);

    const t = token();
    if (t) {
      const cleanup = initEventHandlers();
      connectWS(t);
      setReady(true);
      onCleanup(() => {
        cleanup();
        disconnectWS();
      });
    }
  });

  // Re-connect when token changes (after login)
  const connectOnLogin = () => {
    const t = token();
    if (t && !ready()) {
      const cleanup = initEventHandlers();
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
          {() => {
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
