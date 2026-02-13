import { createSignal, onCleanup, onMount, Show } from "solid-js";
import Login from "./components/Auth/Login";
import Sidebar from "./components/Sidebar/Sidebar";
import TextChannel from "./components/TextChannel/TextChannel";
import VoiceChannel from "./components/VoiceChannel/VoiceChannel";
import SettingsModal from "./components/Settings/SettingsModal";
import { connectWS, disconnectWS } from "./lib/ws";
import { initEventHandlers } from "./lib/events";
import { currentUser, token, login, logout, setUser } from "./stores/auth";
import {
  channels,
  selectedChannelId,
  selectedChannel,
} from "./stores/channels";

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
          "background-color": "var(--bg-tertiary)",
        }}
      >
        <SettingsModal />
        <Sidebar
          onLogout={handleLogout}
          username={
            currentUser()?.username ||
            localStorage.getItem("username") ||
            ""
          }
        />

        <div style={{ flex: "1", display: "flex", "flex-direction": "column" }}>
          {/* Reactive function child — SolidJS re-evaluates this whenever
              selectedChannelId() or channels() change, swapping the
              rendered component entirely. This avoids Show/Switch
              truthiness-memoization pitfalls. */}
          {() => {
            const id = selectedChannelId();
            if (!id) {
              return (
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    height: "100%",
                    color: "var(--text-muted)",
                    "font-size": "16px",
                  }}
                >
                  Select a channel to get started
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
  );
}

export default App;
